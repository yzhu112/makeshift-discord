import { randomUUID } from 'node:crypto';
import { mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

const MiB = 1024 * 1024;
const active = new Set(['connected', 'reconnecting']);
export function clean(value, depth = 0) {
	if (depth > 5) return '[truncated]';
	if (typeof value === 'string')
		return value
			.replace(
				/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
				'[token]',
			)
			.replace(
				/(https?|wss?):\/\/[^\s"<>]+/g,
				(url) => url.split('?')[0].split('#')[0],
			)
			.slice(0, 1500);
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	if (value === null || typeof value === 'boolean') return value;
	if (Array.isArray(value))
		return value.slice(0, 32).map((v) => clean(v, depth + 1));
	if (value && typeof value === 'object')
		return Object.fromEntries(
			Object.entries(value)
				.filter(
					([k]) =>
						!/token|credential|password|secret|authorization|cookie|sdp|address|deviceid|groupid|invite/i.test(
							k,
						),
				)
				.slice(0, 45)
				.map(([k, v]) => [k.slice(0, 80), clean(v, depth + 1)]),
		);
	return null;
}
const json = (value) => JSON.stringify(clean(value ?? {}));
const parsed = (row, fields) =>
	row &&
	Object.fromEntries(
		Object.entries(row).map(([k, v]) => [
			k,
			fields.includes(k) ? JSON.parse(v || '{}') : v,
		]),
	);

export function createDiagnosticsStore(
	path,
	{ budget = 250 * MiB, now = Date.now } = {},
) {
	mkdirSync(dirname(path), { recursive: true });
	const db = new Database(path);
	db.pragma('auto_vacuum = INCREMENTAL');
	db.pragma('journal_mode = WAL');
	db.pragma('foreign_keys = ON');
	db.pragma('synchronous = NORMAL');
	db.pragma('cache_size = -2048');
	const walReserve = Math.min(2 * MiB, budget / 10);
	const pageSize = db.pragma('page_size', { simple: true });
	db.pragma(`max_page_count = ${Math.floor((budget - walReserve) / pageSize)}`);
	db.pragma('wal_autocheckpoint = 32');
	db.pragma(`journal_size_limit = ${Math.floor(walReserve)}`);
	db.exec(`
    CREATE TABLE IF NOT EXISTS calls (
      id TEXT PRIMARY KEY, room_name TEXT NOT NULL, server_instance_id TEXT,
      started_at INTEGER NOT NULL, ended_at INTEGER, end_reason TEXT);
    CREATE INDEX IF NOT EXISTS calls_room_time ON calls(room_name, started_at);
    CREATE TABLE IF NOT EXISTS participant_sessions (
      id TEXT PRIMARY KEY, call_id TEXT REFERENCES calls(id) ON DELETE SET NULL,
      room_name TEXT NOT NULL, user_id INTEGER, username TEXT NOT NULL,
      livekit_room_sid TEXT, livekit_participant_sid TEXT,
      attempted_at INTEGER NOT NULL, connected_at INTEGER, ended_at INTEGER,
      last_seen_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'joining', end_reason TEXT,
      client_info TEXT NOT NULL DEFAULT '{}', last_sequence INTEGER NOT NULL DEFAULT -1);
    CREATE INDEX IF NOT EXISTS sessions_call ON participant_sessions(call_id, attempted_at);
    CREATE INDEX IF NOT EXISTS sessions_sid ON participant_sessions(livekit_participant_sid);
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY, call_id TEXT REFERENCES calls(id) ON DELETE SET NULL,
      participant_session_id TEXT REFERENCES participant_sessions(id) ON DELETE SET NULL,
      room_name TEXT, source TEXT NOT NULL, source_event_id TEXT,
      occurred_at INTEGER NOT NULL, received_at INTEGER NOT NULL,
      level TEXT NOT NULL, type TEXT NOT NULL, message TEXT NOT NULL, details TEXT NOT NULL DEFAULT '{}',
      UNIQUE(source, source_event_id));
    CREATE INDEX IF NOT EXISTS events_session_time ON events(participant_session_id, occurred_at);
    CREATE INDEX IF NOT EXISTS events_call_id ON events(call_id, id);
    CREATE INDEX IF NOT EXISTS events_time ON events(occurred_at);
    CREATE TABLE IF NOT EXISTS participant_samples (
      id INTEGER PRIMARY KEY, participant_session_id TEXT NOT NULL REFERENCES participant_sessions(id) ON DELETE CASCADE,
      sequence_number INTEGER NOT NULL, sampled_at INTEGER NOT NULL, received_at INTEGER NOT NULL,
      data TEXT NOT NULL, UNIQUE(participant_session_id, sequence_number));
    CREATE INDEX IF NOT EXISTS samples_time ON participant_samples(sampled_at);
    CREATE INDEX IF NOT EXISTS samples_session_time ON participant_samples(participant_session_id, sampled_at);
    CREATE TABLE IF NOT EXISTS server_samples (
      id INTEGER PRIMARY KEY, server_instance_id TEXT NOT NULL, sampled_at INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS server_time ON server_samples(sampled_at);
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT);
  `);
	const q = (sql, ...args) => db.prepare(sql).all(...args);
	const one = (sql, ...args) => db.prepare(sql).get(...args);
	const run = (sql, ...args) => db.prepare(sql).run(...args);
	const size = (file) => {
		try {
			return statSync(file).size;
		} catch {
			return 0;
		}
	};
	const used = () =>
		(db.pragma('page_count', { simple: true }) -
			db.pragma('freelist_count', { simple: true })) *
		pageSize;
	let pruning = false;
	function prune(force = false) {
		if (pruning) return;
		const total = size(path) + size(path + '-wal');
		if (
			!force &&
			total < budget - walReserve &&
			used() < budget - walReserve * 2
		) {
			if (size(path + '-wal') > walReserve / 2)
				db.pragma('wal_checkpoint(TRUNCATE)');
			return;
		}
		pruning = true;
		try {
			const target = Math.floor(budget * 0.8) - walReserve;
			let removed = 0;
			// Bounded batches and indexed oldest-first scans. Never delete active sessions.
			while (used() > target) {
				const oldest =
					q(`SELECT * FROM (SELECT 'participant_samples' AS t, id, sampled_at FROM participant_samples
          UNION ALL SELECT 'server_samples', id, sampled_at FROM server_samples)
          ORDER BY sampled_at LIMIT 500`);
				let changes = 0;
				if (oldest.length) {
					for (const table of ['participant_samples', 'server_samples']) {
						const ids = oldest
							.filter((row) => row.t === table)
							.map((row) => row.id);
						if (ids.length)
							changes += run(
								`DELETE FROM ${table} WHERE id IN (${ids.map(() => '?').join(',')})`,
								...ids,
							).changes;
					}
				} else if (one('SELECT id FROM events LIMIT 1')) {
					changes = run(
						'DELETE FROM events WHERE id IN (SELECT id FROM events ORDER BY occurred_at LIMIT 500)',
					).changes;
				} else {
					changes = run(
						'DELETE FROM participant_sessions WHERE id IN (SELECT id FROM participant_sessions WHERE ended_at IS NOT NULL ORDER BY attempted_at LIMIT 100)',
					).changes;
					changes += run(
						'DELETE FROM calls WHERE ended_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM participant_sessions WHERE call_id = calls.id)',
					).changes;
				}
				removed += changes;
				if (!changes) break;
			}
			if (removed)
				run(
					"INSERT OR REPLACE INTO metadata VALUES ('last_pruned_at', ?)",
					String(now()),
				);
			db.pragma('wal_checkpoint(TRUNCATE)');
			while (db.pragma('freelist_count', { simple: true }) > 0) {
				db.pragma('incremental_vacuum(512)');
				db.pragma('wal_checkpoint(TRUNCATE)');
			}
		} finally {
			pruning = false;
		}
	}
	function write(fn) {
		prune();
		try {
			return db.transaction(fn)();
		} catch (error) {
			if (error.code !== 'SQLITE_FULL') throw error;
			prune(true);
			return db.transaction(fn)();
		} finally {
			prune();
		}
	}
	function session(id) {
		return parsed(one('SELECT * FROM participant_sessions WHERE id = ?', id), [
			'client_info',
		]);
	}
	function ensureSession({
		id,
		roomName,
		userId,
		username,
		clientInfo = {},
		attemptedAt = now(),
	}) {
		const existing = session(id);
		if (existing) {
			if (existing.user_id !== userId || existing.room_name !== roomName)
				throw new Error('Session belongs to a different join attempt');
			return existing;
		}
		return write(() => {
			run(
				`INSERT INTO participant_sessions(id,room_name,user_id,username,attempted_at,last_seen_at,client_info)
        VALUES (?,?,?,?,?,?,?)`,
				id,
				roomName,
				userId,
				username,
				attemptedAt,
				now(),
				json(clientInfo),
			);
			return session(id);
		});
	}
	function event({
		sessionId = null,
		callId = null,
		roomName = null,
		source = 'backend',
		sourceId = null,
		at = now(),
		level = 'info',
		type,
		message = type,
		details = {},
	}) {
		const s = sessionId ? session(sessionId) : null;
		return run(
			`INSERT OR IGNORE INTO events(call_id,participant_session_id,room_name,source,source_event_id,
      occurred_at,received_at,level,type,message,details) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
			callId ?? s?.call_id ?? null,
			s?.id ?? null,
			roomName ?? s?.room_name ?? null,
			source,
			sourceId,
			at,
			now(),
			level,
			type,
			clean(message),
			json(details),
		).changes;
	}
	function connect(s, at, details = {}) {
		if (s.ended_at != null) return; // Delayed uploads/webhooks cannot resurrect a finished attempt.
		let call = s.call_id
			? one('SELECT * FROM calls WHERE id = ?', s.call_id)
			: null;
		if (!call || call.ended_at != null) {
			call = one(
				'SELECT * FROM calls WHERE room_name = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1',
				s.room_name,
			);
			if (!call) {
				call = { id: randomUUID() };
				run(
					'INSERT INTO calls(id,room_name,started_at,server_instance_id) VALUES (?,?,?,?)',
					call.id,
					s.room_name,
					at,
					details.serverInstanceId ?? null,
				);
			}
		}
		run(
			`UPDATE participant_sessions SET call_id=?, connected_at=COALESCE(connected_at,?), status='connected',
      livekit_room_sid=COALESCE(?,livekit_room_sid),livekit_participant_sid=COALESCE(?,livekit_participant_sid) WHERE id=?`,
			call.id,
			at,
			details.roomSid ?? null,
			details.participantSid ?? null,
			s.id,
		);
		run(
			'UPDATE events SET call_id=? WHERE participant_session_id=? AND call_id IS NULL',
			call.id,
			s.id,
		);
	}
	function end(id, reason, at = now(), status = 'left') {
		const s = session(id);
		if (!s || s.ended_at != null) return;
		run(
			'UPDATE participant_sessions SET ended_at=?,end_reason=?,status=? WHERE id=?',
			Math.max(at, s.attempted_at),
			reason,
			status,
			id,
		);
		if (
			s.call_id &&
			!one(
				"SELECT id FROM participant_sessions WHERE call_id=? AND ended_at IS NULL AND status IN ('connected','reconnecting')",
				s.call_id,
			)
		) {
			run(
				'UPDATE calls SET ended_at=?,end_reason=? WHERE id=? AND ended_at IS NULL',
				Math.max(at, s.connected_at ?? at),
				reason === 'server_shutdown' ? reason : 'empty',
				s.call_id,
			);
		}
	}
	function ingest(id, userId, batch) {
		const s = session(id);
		if (!s || s.user_id !== userId) return false;
		write(() => {
			run(
				'UPDATE participant_sessions SET last_seen_at=? WHERE id=?',
				now(),
				id,
			);
			if (batch.clientInfo)
				run(
					'UPDATE participant_sessions SET client_info=? WHERE id=?',
					json(batch.clientInfo),
					id,
				);
			for (const e of [...batch.events].sort((a, b) => a.seq - b.seq)) {
				const added = event({
					sessionId: id,
					source: 'browser',
					sourceId: `${id}:${e.seq}`,
					at: e.at,
					type: e.type,
					message: e.message,
					level: e.level,
					details: e.details,
				});
				if (!added) continue;
				const current = session(id);
				if (e.seq <= current.last_sequence || current.ended_at != null)
					continue;
				run(
					'UPDATE participant_sessions SET last_sequence=? WHERE id=?',
					e.seq,
					id,
				);
				if (e.type === 'connected') connect(current, e.at, e.details);
				if (e.type === 'reconnecting' || e.type === 'signal_reconnecting')
					run(
						"UPDATE participant_sessions SET status='reconnecting' WHERE id=? AND connected_at IS NOT NULL",
						id,
					);
				if (
					e.type === 'disconnected' ||
					e.type === 'join_failed' ||
					e.type === 'cancelled'
				)
					end(
						id,
						e.details?.reason ?? e.message ?? e.type,
						e.at,
						e.type === 'join_failed' ? 'failed' : 'left',
					);
			}
			for (const sample of batch.samples)
				run(
					`INSERT OR IGNORE INTO participant_samples
        (participant_session_id,sequence_number,sampled_at,received_at,data) VALUES (?,?,?,?,?)`,
					id,
					sample.seq,
					sample.at,
					now(),
					json(sample.data),
				);
		});
		return true;
	}
	function lifecycle({
		id,
		type,
		at,
		roomName,
		roomSid,
		participantSid,
		identity,
		metadata,
		reason,
	}) {
		write(() => {
			if (
				one(
					'SELECT id FROM events WHERE source=? AND source_event_id=?',
					'livekit',
					id,
				)
			)
				return;
			let s = participantSid
				? session(
						one(
							'SELECT id FROM participant_sessions WHERE livekit_participant_sid=?',
							participantSid,
						)?.id ?? '',
					)
				: null;
			if (!s && metadata?.diagnosticSessionId) {
				const candidate = session(metadata.diagnosticSessionId);
				if (
					candidate?.room_name === roomName &&
					candidate.username === identity
				)
					s = candidate;
			}
			if (type === 'participant_joined' && !s) {
				const sid = randomUUID();
				run(
					`INSERT INTO participant_sessions(id,room_name,username,attempted_at,last_seen_at,client_info)
          VALUES (?,?,?,?,?,?)`,
					sid,
					roomName,
					identity ?? 'Unknown',
					at,
					now(),
					'{}',
				);
				s = session(sid);
			}
			if (s && participantSid)
				run(
					'UPDATE participant_sessions SET livekit_participant_sid=?,livekit_room_sid=? WHERE id=?',
					participantSid,
					roomSid ?? null,
					s.id,
				);
			if (s && type === 'participant_joined')
				connect(s, at, { roomSid, participantSid });
			event({
				sessionId: s?.id,
				roomName,
				source: 'livekit',
				sourceId: id,
				at,
				type,
				details: { reason, roomSid, participantSid },
			});
			if (
				s &&
				(type === 'participant_left' ||
					type === 'participant_connection_aborted')
			)
				end(
					s.id,
					reason || type,
					at,
					type === 'participant_connection_aborted' ? 'failed' : 'left',
				);
			if (type === 'room_finished' && roomSid) {
				for (const row of q(
					'SELECT id FROM participant_sessions WHERE livekit_room_sid=? AND ended_at IS NULL AND attempted_at<=?',
					roomSid,
					at,
				))
					end(row.id, 'room_finished', at);
			}
		});
	}
	function reconcile(participants) {
		// Only invoked after a successful server API snapshot. A missing browser report is not proof of disconnect.
		write(() => {
			const present = new Set(participants.map((p) => p.sid));
			for (const p of participants) {
				let metadata = {};
				try {
					metadata = JSON.parse(p.metadata || '{}');
				} catch {}
				const s = metadata.diagnosticSessionId
					? session(metadata.diagnosticSessionId)
					: null;
				if (
					s &&
					!s.ended_at &&
					s.room_name === p.roomName &&
					s.username === p.identity
				)
					connect(s, now(), { roomSid: p.roomSid, participantSid: p.sid });
			}
			for (const s of q(
				'SELECT * FROM participant_sessions WHERE ended_at IS NULL AND last_seen_at<?',
				now() - 45000,
			)) {
				if (s.livekit_participant_sid && present.has(s.livekit_participant_sid))
					continue;
				if (
					participants.some(
						(p) =>
							p.roomName === s.room_name &&
							p.identity === s.username &&
							!s.livekit_participant_sid,
					)
				)
					continue;
				event({
					sessionId: s.id,
					type: 'presence_lost',
					level: 'warning',
					message:
						'No participant found in a successful LiveKit snapshot; final client reason unavailable',
				});
				end(s.id, 'absent_from_livekit', now(), 'unknown');
			}
		});
	}
	function storage() {
		return {
			bytes: size(path) + size(path + '-wal'),
			budget,
			target: Math.floor(budget * 0.8),
			lastPrunedAt:
				Number(
					one("SELECT value FROM metadata WHERE key='last_pruned_at'")?.value,
				) || null,
		};
	}
	return {
		db,
		session,
		ensureSession,
		ingest,
		lifecycle,
		reconcile,
		storage,
		prune,
		record: (data) => write(() => event(data)),
		finish: (id, reason, status = 'failed') =>
			write(() => end(id, reason, now(), status)),
		serverSample: (id, data) =>
			write(() =>
				run(
					'INSERT INTO server_samples(server_instance_id,sampled_at,data) VALUES (?,?,?)',
					id,
					now(),
					json(data),
				),
			),
		overview: (before = now() + 1) => ({
			now: now(),
			storage: storage(),
			calls: q(
				`SELECT c.*, (SELECT count(DISTINCT username) FROM participant_sessions s WHERE s.call_id=c.id) AS participant_count,
        (SELECT count(*) FROM participant_sessions s WHERE s.call_id=c.id AND s.ended_at IS NULL) AS active_count,
        (SELECT max(last_seen_at) FROM participant_sessions s WHERE s.call_id=c.id) AS last_seen_at
        FROM calls c WHERE c.started_at<? ORDER BY c.ended_at IS NULL DESC,c.started_at DESC LIMIT 50`,
				before,
			),
			attempts: q(
				'SELECT * FROM participant_sessions WHERE call_id IS NULL ORDER BY attempted_at DESC LIMIT 50',
			).map((s) => parsed(s, ['client_info'])),
			server:
				parsed(
					one('SELECT * FROM server_samples ORDER BY sampled_at DESC LIMIT 1'),
					['data'],
				) ?? null,
		}),
		call: (id) => {
			const call = one('SELECT * FROM calls WHERE id=?', id);
			if (!call) return null;
			return {
				...call,
				sessions: q(
					'SELECT * FROM participant_sessions WHERE call_id=? ORDER BY attempted_at',
					id,
				).map((s) => ({
					...parsed(s, ['client_info']),
					latest:
						parsed(
							one(
								'SELECT * FROM participant_samples WHERE participant_session_id=? ORDER BY sampled_at DESC LIMIT 1',
								s.id,
							),
							['data'],
						) ?? null,
				})),
			};
		},
		events: ({
			callId,
			sessionId,
			before = Number.MAX_SAFE_INTEGER,
			level,
			serverOnly,
		}) => {
			const clauses = ['id<?'];
			const args = [before];
			if (callId) {
				clauses.push('call_id=?');
				args.push(callId);
			}
			if (sessionId) {
				clauses.push('participant_session_id=?');
				args.push(sessionId);
			}
			if (level) {
				clauses.push('level=?');
				args.push(level);
			}
			if (serverOnly) clauses.push('participant_session_id IS NULL');
			return q(
				`SELECT * FROM events WHERE ${clauses.join(' AND ')} ORDER BY id DESC LIMIT 150`,
				...args,
			).map((e) => parsed(e, ['details']));
		},
		samples: (sessionId, from = 0, to = now()) => {
			const bounds = one(
				'SELECT min(sampled_at) AS first,max(sampled_at) AS last FROM participant_samples WHERE participant_session_id=? AND sampled_at BETWEEN ? AND ?',
				sessionId,
				from,
				to,
			);
			const bucket = Math.max(
				1,
				Math.ceil(((bounds?.last ?? 0) - (bounds?.first ?? 0)) / 250),
			);
			return q(
				`SELECT *,MAX(sampled_at) AS sampled_at FROM participant_samples WHERE participant_session_id=? AND sampled_at BETWEEN ? AND ? GROUP BY CAST((sampled_at-?)/? AS INTEGER) ORDER BY sampled_at`,
				sessionId,
				from,
				to,
				bounds?.first ?? 0,
				bucket,
			).map((s) => parsed(s, ['data']));
		},
		serverSamples: () =>
			q('SELECT * FROM server_samples ORDER BY sampled_at DESC LIMIT 120')
				.reverse()
				.map((s) => parsed(s, ['data'])),
		shutdown: () => {
			write(() => {
				for (const s of q(
					'SELECT id FROM participant_sessions WHERE ended_at IS NULL',
				)) {
					event({
						sessionId: s.id,
						type: 'server_shutdown',
						message: 'Backend shutting down; call boundary may be incomplete',
					});
					end(s.id, 'server_shutdown', now(), 'unknown');
				}
			});
			db.pragma('wal_checkpoint(TRUNCATE)');
			db.close();
		},
		close: () => {
			db.pragma('wal_checkpoint(TRUNCATE)');
			db.close();
		},
	};
}
