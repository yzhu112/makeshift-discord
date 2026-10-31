import { randomUUID } from 'node:crypto';
import { mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import {
	and,
	asc,
	between,
	count,
	countDistinct,
	desc,
	eq,
	getTableColumns,
	inArray,
	isNotNull,
	isNull,
	lt,
	lte,
	max,
	min,
	notExists,
	sql,
} from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrateDiagnostics } from '../../migrate.js';
import { calls } from '../../schemas/diagnostics/calls.js';
import { events } from '../../schemas/diagnostics/events.js';
import { metadata as metadataTable } from '../../schemas/diagnostics/metadata.js';
import { participant_samples as samples } from '../../schemas/diagnostics/participant_samples.js';
import { participant_sessions as sessions } from '../../schemas/diagnostics/participant_sessions.js';
import { server_samples as serverSamples } from '../../schemas/diagnostics/server_samples.js';

const MiB = 1024 * 1024;
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
	const sqlite = new Database(path);
	sqlite.pragma('auto_vacuum = INCREMENTAL');
	sqlite.pragma('journal_mode = WAL');
	sqlite.pragma('foreign_keys = ON');
	sqlite.pragma('synchronous = NORMAL');
	sqlite.pragma('cache_size = -2048');
	const walReserve = Math.min(2 * MiB, budget / 10);
	const pageSize = sqlite.pragma('page_size', { simple: true });
	sqlite.pragma(
		`max_page_count = ${Math.floor((budget - walReserve) / pageSize)}`,
	);
	sqlite.pragma('wal_autocheckpoint = 32');
	sqlite.pragma(`journal_size_limit = ${Math.floor(walReserve)}`);
	migrateDiagnostics(sqlite);
	const db = drizzle(sqlite);
	const size = (file) => {
		try {
			return statSync(file).size;
		} catch {
			return 0;
		}
	};
	const used = () =>
		(sqlite.pragma('page_count', { simple: true }) -
			sqlite.pragma('freelist_count', { simple: true })) *
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
				sqlite.pragma('wal_checkpoint(TRUNCATE)');
			return;
		}
		pruning = true;
		try {
			const target = Math.floor(budget * 0.8) - walReserve;
			let removed = 0;
			// Bounded batches and indexed oldest-first scans. Never delete active sessions.
			while (used() > target) {
				const oldest = db
					.select({
						t: sql`'participant_samples'`.as('t'),
						id: samples.id,
						sampled_at: samples.sampled_at,
					})
					.from(samples)
					.unionAll(
						db
							.select({
								t: sql`'server_samples'`,
								id: serverSamples.id,
								sampled_at: serverSamples.sampled_at,
							})
							.from(serverSamples),
					)
					.orderBy(asc(sql`sampled_at`))
					.limit(500)
					.all();
				let changes = 0;
				if (oldest.length) {
					for (const [name, table] of [
						['participant_samples', samples],
						['server_samples', serverSamples],
					]) {
						const ids = oldest
							.filter((row) => row.t === name)
							.map((row) => row.id);
						if (ids.length)
							changes += db
								.delete(table)
								.where(inArray(table.id, ids))
								.run().changes;
					}
				} else if (db.select({ id: events.id }).from(events).limit(1).get()) {
					changes = db
						.delete(events)
						.where(
							inArray(
								events.id,
								db
									.select({ id: events.id })
									.from(events)
									.orderBy(events.occurred_at)
									.limit(500),
							),
						)
						.run().changes;
				} else {
					changes = db
						.delete(sessions)
						.where(
							inArray(
								sessions.id,
								db
									.select({ id: sessions.id })
									.from(sessions)
									.where(isNotNull(sessions.ended_at))
									.orderBy(sessions.attempted_at)
									.limit(100),
							),
						)
						.run().changes;
					changes += db
						.delete(calls)
						.where(
							and(
								isNotNull(calls.ended_at),
								notExists(
									db
										.select({ id: sessions.id })
										.from(sessions)
										.where(eq(sessions.call_id, calls.id)),
								),
							),
						)
						.run().changes;
				}
				removed += changes;
				if (!changes) break;
			}
			if (removed)
				db.insert(metadataTable)
					.values({ key: 'last_pruned_at', value: String(now()) })
					.onConflictDoUpdate({
						target: metadataTable.key,
						set: { value: String(now()) },
					})
					.run();
			sqlite.pragma('wal_checkpoint(TRUNCATE)');
			while (sqlite.pragma('freelist_count', { simple: true }) > 0) {
				sqlite.pragma('incremental_vacuum(512)');
				sqlite.pragma('wal_checkpoint(TRUNCATE)');
			}
		} finally {
			pruning = false;
		}
	}
	function write(fn) {
		prune();
		try {
			return db.transaction(fn);
		} catch (error) {
			if (error.code !== 'SQLITE_FULL') throw error;
			prune(true);
			return db.transaction(fn);
		} finally {
			prune();
		}
	}
	function session(id) {
		return parsed(db.select().from(sessions).where(eq(sessions.id, id)).get(), [
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
			db.insert(sessions)
				.values({
					id,
					room_name: roomName,
					user_id: userId,
					username,
					attempted_at: attemptedAt,
					last_seen_at: now(),
					client_info: json(clientInfo),
				})
				.run();
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
		return db
			.insert(events)
			.values({
				call_id: callId ?? s?.call_id ?? null,
				participant_session_id: s?.id ?? null,
				room_name: roomName ?? s?.room_name ?? null,
				source,
				source_event_id: sourceId,
				occurred_at: at,
				received_at: now(),
				level,
				type,
				message: clean(message),
				details: json(details),
			})
			.onConflictDoNothing({ target: [events.source, events.source_event_id] })
			.run().changes;
	}
	function connect(s, at, details = {}) {
		if (s.ended_at != null) return; // Delayed uploads/webhooks cannot resurrect a finished attempt.
		let call = s.call_id
			? db.select().from(calls).where(eq(calls.id, s.call_id)).get()
			: null;
		if (!call || call.ended_at != null) {
			call = db
				.select()
				.from(calls)
				.where(and(eq(calls.room_name, s.room_name), isNull(calls.ended_at)))
				.orderBy(desc(calls.started_at))
				.limit(1)
				.get();
			if (!call) {
				call = { id: randomUUID() };
				db.insert(calls)
					.values({
						id: call.id,
						room_name: s.room_name,
						started_at: at,
						server_instance_id: details.serverInstanceId ?? null,
					})
					.run();
			}
		}
		db.update(sessions)
			.set({
				call_id: call.id,
				connected_at: sql`coalesce(${sessions.connected_at}, ${at})`,
				status: 'connected',
				livekit_room_sid: sql`coalesce(${details.roomSid ?? null}, ${sessions.livekit_room_sid})`,
				livekit_participant_sid: sql`coalesce(${details.participantSid ?? null}, ${sessions.livekit_participant_sid})`,
			})
			.where(eq(sessions.id, s.id))
			.run();
		db.update(events)
			.set({ call_id: call.id })
			.where(
				and(eq(events.participant_session_id, s.id), isNull(events.call_id)),
			)
			.run();
	}
	function end(id, reason, at = now(), status = 'left') {
		const s = session(id);
		if (!s || s.ended_at != null) return;
		db.update(sessions)
			.set({
				ended_at: Math.max(at, s.attempted_at),
				end_reason: reason,
				status,
			})
			.where(eq(sessions.id, id))
			.run();
		if (
			s.call_id &&
			!db
				.select({ id: sessions.id })
				.from(sessions)
				.where(
					and(
						eq(sessions.call_id, s.call_id),
						isNull(sessions.ended_at),
						inArray(sessions.status, ['connected', 'reconnecting']),
					),
				)
				.limit(1)
				.get()
		) {
			db.update(calls)
				.set({
					ended_at: Math.max(at, s.connected_at ?? at),
					end_reason: reason === 'server_shutdown' ? reason : 'empty',
				})
				.where(and(eq(calls.id, s.call_id), isNull(calls.ended_at)))
				.run();
		}
	}
	function ingest(id, userId, batch) {
		const s = session(id);
		if (!s || s.user_id !== userId) return false;
		write(() => {
			db.update(sessions)
				.set({ last_seen_at: now() })
				.where(eq(sessions.id, id))
				.run();
			if (batch.clientInfo)
				db.update(sessions)
					.set({ client_info: json(batch.clientInfo) })
					.where(eq(sessions.id, id))
					.run();
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
				db.update(sessions)
					.set({ last_sequence: e.seq })
					.where(eq(sessions.id, id))
					.run();
				if (e.type === 'connected') connect(current, e.at, e.details);
				if (e.type === 'reconnecting' || e.type === 'signal_reconnecting')
					db.update(sessions)
						.set({ status: 'reconnecting' })
						.where(and(eq(sessions.id, id), isNotNull(sessions.connected_at)))
						.run();
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
				db.insert(samples)
					.values({
						participant_session_id: id,
						sequence_number: sample.seq,
						sampled_at: sample.at,
						received_at: now(),
						data: json(sample.data),
					})
					.onConflictDoNothing({
						target: [samples.participant_session_id, samples.sequence_number],
					})
					.run();
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
				db
					.select({ id: events.id })
					.from(events)
					.where(
						and(eq(events.source, 'livekit'), eq(events.source_event_id, id)),
					)
					.limit(1)
					.get()
			)
				return;
			let s = participantSid
				? session(
						db
							.select({ id: sessions.id })
							.from(sessions)
							.where(eq(sessions.livekit_participant_sid, participantSid))
							.limit(1)
							.get()?.id ?? '',
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
				db.insert(sessions)
					.values({
						id: sid,
						room_name: roomName,
						username: identity ?? 'Unknown',
						attempted_at: at,
						last_seen_at: now(),
						client_info: '{}',
					})
					.run();
				s = session(sid);
			}
			if (s && participantSid)
				db.update(sessions)
					.set({
						livekit_participant_sid: participantSid,
						livekit_room_sid: roomSid ?? null,
					})
					.where(eq(sessions.id, s.id))
					.run();
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
				for (const row of db
					.select({ id: sessions.id })
					.from(sessions)
					.where(
						and(
							eq(sessions.livekit_room_sid, roomSid),
							isNull(sessions.ended_at),
							lte(sessions.attempted_at, at),
						),
					)
					.all())
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
			for (const s of db
				.select()
				.from(sessions)
				.where(
					and(
						isNull(sessions.ended_at),
						lt(sessions.last_seen_at, now() - 45000),
					),
				)
				.all()) {
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
					db
						.select({ value: metadataTable.value })
						.from(metadataTable)
						.where(eq(metadataTable.key, 'last_pruned_at'))
						.get()?.value,
				) || null,
		};
	}
	return {
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
				db
					.insert(serverSamples)
					.values({
						server_instance_id: id,
						sampled_at: now(),
						data: json(data),
					})
					.run(),
			),
		overview: (before = now() + 1) => ({
			now: now(),
			storage: storage(),
			calls: db
				.select({
					...getTableColumns(calls),
					participant_count: sql`(${db
						.select({ value: countDistinct(sessions.username) })
						.from(sessions)
						.where(eq(sessions.call_id, calls.id))})`.mapWith(Number),
					active_count: sql`(${db
						.select({ value: count() })
						.from(sessions)
						.where(
							and(eq(sessions.call_id, calls.id), isNull(sessions.ended_at)),
						)})`.mapWith(Number),
					last_seen_at: sql`(${db
						.select({ value: max(sessions.last_seen_at) })
						.from(sessions)
						.where(eq(sessions.call_id, calls.id))})`.mapWith(Number),
				})
				.from(calls)
				.where(lt(calls.started_at, before))
				.orderBy(desc(isNull(calls.ended_at)), desc(calls.started_at))
				.limit(50)
				.all(),
			attempts: db
				.select()
				.from(sessions)
				.where(isNull(sessions.call_id))
				.orderBy(desc(sessions.attempted_at))
				.limit(50)
				.all()
				.map((s) => parsed(s, ['client_info'])),
			server:
				parsed(
					db
						.select()
						.from(serverSamples)
						.orderBy(desc(serverSamples.sampled_at))
						.limit(1)
						.get(),
					['data'],
				) ?? null,
		}),
		call: (id) => {
			const call = db.select().from(calls).where(eq(calls.id, id)).get();
			if (!call) return null;
			return {
				...call,
				sessions: db
					.select()
					.from(sessions)
					.where(eq(sessions.call_id, id))
					.orderBy(sessions.attempted_at)
					.all()
					.map((s) => ({
						...parsed(s, ['client_info']),
						latest:
							parsed(
								db
									.select()
									.from(samples)
									.where(eq(samples.participant_session_id, s.id))
									.orderBy(desc(samples.sampled_at))
									.limit(1)
									.get(),
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
			return db
				.select()
				.from(events)
				.where(
					and(
						lt(events.id, before),
						callId ? eq(events.call_id, callId) : undefined,
						sessionId
							? eq(events.participant_session_id, sessionId)
							: undefined,
						level ? eq(events.level, level) : undefined,
						serverOnly ? isNull(events.participant_session_id) : undefined,
					),
				)
				.orderBy(desc(events.id))
				.limit(150)
				.all()
				.map((e) => parsed(e, ['details']));
		},
		samples: (sessionId, from = 0, to = now()) => {
			const bounds = db
				.select({
					first: min(samples.sampled_at),
					last: max(samples.sampled_at),
				})
				.from(samples)
				.where(
					and(
						eq(samples.participant_session_id, sessionId),
						between(samples.sampled_at, from, to),
					),
				)
				.get();
			const bucket = Math.max(
				1,
				Math.ceil(((bounds?.last ?? 0) - (bounds?.first ?? 0)) / 250),
			);
			// SQLite selects the other columns from the row supplying MAX(sampled_at).
			// Keep that single aggregate so each bucket retains one complete latest sample.
			return db
				.select({
					...getTableColumns(samples),
					sampled_at: max(samples.sampled_at),
				})
				.from(samples)
				.where(
					and(
						eq(samples.participant_session_id, sessionId),
						between(samples.sampled_at, from, to),
					),
				)
				.groupBy(
					sql`cast((${samples.sampled_at} - ${bounds?.first ?? 0}) / ${bucket} as integer)`,
				)
				.orderBy(samples.sampled_at)
				.all()
				.map((s) => parsed(s, ['data']));
		},
		serverSamples: () =>
			db
				.select()
				.from(serverSamples)
				.orderBy(desc(serverSamples.sampled_at))
				.limit(120)
				.all()
				.reverse()
				.map((s) => parsed(s, ['data'])),
		shutdown: () => {
			write(() => {
				for (const s of db
					.select({ id: sessions.id })
					.from(sessions)
					.where(isNull(sessions.ended_at))
					.all()) {
					event({
						sessionId: s.id,
						type: 'server_shutdown',
						message: 'Backend shutting down; call boundary may be incomplete',
					});
					end(s.id, 'server_shutdown', now(), 'unknown');
				}
			});
			sqlite.pragma('wal_checkpoint(TRUNCATE)');
			sqlite.close();
		},
		close: () => {
			sqlite.pragma('wal_checkpoint(TRUNCATE)');
			sqlite.close();
		},
	};
}
