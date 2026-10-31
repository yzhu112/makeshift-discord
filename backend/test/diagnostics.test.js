import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { clean, createDiagnosticsStore } from '@voice/db/diagnostics';
import Database from 'better-sqlite3';

function fixture(t, options = {}) {
	const dir = mkdtempSync(join(tmpdir(), 'voice-diag-test-'));
	let clock = 1_000_000;
	const store = createDiagnosticsStore(join(dir, 'diagnostics.db'), {
		now: () => clock,
		...options,
	});
	const inspect = new Database(join(dir, 'diagnostics.db'), { readonly: true });
	t.after(() => {
		inspect.close();
		store.close();
		rmSync(dir, { recursive: true, force: true });
	});
	const start = (id, userId = 1) =>
		store.ensureSession({
			id,
			roomName: 'home',
			userId,
			username: `user${userId}`,
			attemptedAt: clock,
		});
	const send = (id, type, seq = 0, details = {}) =>
		store.ingest(id, store.session(id).user_id, {
			events: [{ seq, at: clock, type, level: 'info', message: type, details }],
			samples: [],
		});
	return { store, inspect, start, send, advance: (ms) => (clock += ms) };
}

test('a call starts on first connection and ends on last departure; next call is separate', (t) => {
	const { store, start, send, advance } = fixture(t);
	start('a');
	start('b', 2);
	assert.equal(store.overview().calls.length, 0);
	send('a', 'connected');
	advance(1000);
	send('b', 'connected');
	const callId = store.session('a').call_id;
	assert.equal(store.session('b').call_id, callId);
	send('a', 'disconnected', 1, { reason: 'client_left' });
	assert.equal(store.call(callId).ended_at, null);
	advance(1000);
	send('b', 'disconnected', 1, { reason: 'client_left' });
	assert.ok(store.call(callId).ended_at);
	start('c');
	send('c', 'connected');
	assert.notEqual(store.session('c').call_id, callId);
	assert.equal(store.overview().calls.length, 2);
});

test('failed joins remain visible without manufacturing a call', (t) => {
	const { store, start, send } = fixture(t);
	start('a');
	send('a', 'join_failed', 0, { reason: 'Token HTTP 403' });
	assert.equal(store.overview().calls.length, 0);
	assert.equal(store.overview().attempts[0].status, 'failed');
	assert.equal(store.session('a').end_reason, 'Token HTTP 403');
});

test('retries are deduplicated and delayed events never reopen a finished session', (t) => {
	const { store, start, send } = fixture(t);
	start('a');
	send('a', 'connected');
	send('a', 'connected');
	send('a', 'disconnected', 2, { reason: 'left' });
	send('a', 'connected', 1);
	send('a', 'connected', 3);
	assert.equal(store.session('a').status, 'left');
	assert.equal(store.overview().calls.length, 1);
	const sample = {
		seq: 9,
		at: 1_000_000,
		data: { connectionState: 'connected' },
	};
	for (let i = 0; i < 2; i++)
		store.ingest('a', 1, { events: [], samples: [sample] });
	assert.equal(store.samples('a').length, 1);
	assert.equal(store.events({ sessionId: 'a' }).length, 4);
});

test('client sessions are tied to their authenticated owner and room', (t) => {
	const { store, start } = fixture(t);
	start('a');
	assert.equal(store.ingest('a', 2, { events: [], samples: [] }), false);
	assert.throws(() =>
		store.ensureSession({
			id: 'a',
			roomName: 'home',
			userId: 2,
			username: 'other',
		}),
	);
	assert.throws(() =>
		store.ensureSession({
			id: 'a',
			roomName: 'another',
			userId: 1,
			username: 'user1',
		}),
	);
});

test('webhooks correlate to the token attempt and cannot close a newer call', (t) => {
	const { store, start, send, advance } = fixture(t);
	start('a');
	send('a', 'connected');
	const joined = {
		id: 'w1',
		type: 'participant_joined',
		at: 1_000_000,
		roomName: 'home',
		roomSid: 'RM_1',
		participantSid: 'PA_1',
		identity: 'user1',
		metadata: { diagnosticSessionId: 'a' },
	};
	store.lifecycle(joined);
	store.lifecycle(joined);
	assert.equal(store.call(store.session('a').call_id).sessions.length, 1);
	store.lifecycle({
		...joined,
		id: 'w2',
		type: 'participant_left',
		reason: 'CLIENT_INITIATED',
	});
	advance(1000);
	start('b');
	send('b', 'connected');
	store.lifecycle({ ...joined, id: 'w3', type: 'room_finished' });
	assert.equal(store.session('b').ended_at, null);
	assert.equal(store.session('a').end_reason, 'CLIENT_INITIATED');
	assert.equal(
		store
			.events({ sessionId: 'a' })
			.filter((e) => e.type === 'participant_joined').length,
		1,
	);
});

test('a stale heartbeat does not end a participant still present on the server', (t) => {
	const { store, start, send, advance } = fixture(t);
	start('a');
	send('a', 'connected', 0, { roomSid: 'RM_1', participantSid: 'PA_1' });
	advance(60000);
	store.reconcile([
		{
			sid: 'PA_1',
			identity: 'user1',
			roomName: 'home',
			roomSid: 'RM_1',
			metadata: JSON.stringify({ diagnosticSessionId: 'a' }),
		},
	]);
	assert.equal(store.session('a').ended_at, null);
	store.reconcile([]);
	assert.equal(store.session('a').status, 'unknown');
	assert.equal(store.session('a').end_reason, 'absent_from_livekit');
});

test('no age expiry: old samples remain until storage pressure', (t) => {
	const { store, start, advance } = fixture(t);
	start('a');
	store.ingest('a', 1, {
		events: [],
		samples: [{ seq: 1, at: 1, data: { value: 1 } }],
	});
	advance(365 * 86400000);
	store.prune();
	assert.equal(store.samples('a').length, 1);
	assert.equal(store.storage().lastPrunedAt, null);
});

test('capacity cleanup removes oldest data, keeps active metadata, and reclaims DB/WAL space', (t) => {
	const budget = 2 * 1024 * 1024;
	const { store, inspect, start, advance } = fixture(t, { budget });
	start('a');
	for (let i = 0; i < 1200; i++) {
		advance(2000);
		store.ingest('a', 1, {
			events: [],
			samples: [
				{
					seq: i,
					at: 1_000_000 + i * 2000,
					data: {
						deviceState: { a: 'x'.repeat(1400), b: 'y'.repeat(1400) },
						sequence: i,
					},
				},
			],
		});
	}
	assert.ok(store.storage().lastPrunedAt);
	assert.ok(store.storage().bytes <= budget, JSON.stringify(store.storage()));
	assert.ok(
		inspect
			.prepare('SELECT MIN(sequence_number) AS n FROM participant_samples')
			.get().n > 0,
	);
	assert.equal(
		inspect
			.prepare('SELECT MAX(sequence_number) AS n FROM participant_samples')
			.get().n,
		1199,
	);
	assert.ok(store.session('a'));
	assert.equal(inspect.pragma('quick_check', { simple: true }), 'ok');
});

test('event-only load is bounded too', (t) => {
	const { store, inspect } = fixture(t, { budget: 1024 * 1024 });
	for (let i = 0; i < 700; i++)
		store.record({
			type: 'error',
			sourceId: String(i),
			message: 'e'.repeat(1400),
			details: { text: 'z'.repeat(1400) },
			at: i,
		});
	assert.ok(store.storage().lastPrunedAt);
	assert.ok(store.storage().bytes <= 1024 * 1024);
	assert.ok(
		inspect.prepare('SELECT MIN(occurred_at) AS n FROM events').get().n > 0,
	);
});

test('stored diagnostic details omit credentials, SDP, device identifiers and query strings', () => {
	const result = clean({
		token: 'abc',
		nested: { password: 'bad', sdp: 'bad', deviceId: 'bad', reason: 'timeout' },
		url: 'wss://host/rtc?access_token=secret',
		message: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature',
	});
	assert.equal(result.token, undefined);
	assert.deepEqual(result.nested, { reason: 'timeout' });
	assert.equal(result.url, 'wss://host/rtc');
	assert.equal(result.message, '[token]');
});

test('overview aggregates distinct participants and active sessions; events retain filters and cursors', (t) => {
	const { store, start, send, advance } = fixture(t);
	start('a', 1);
	start('b', 1);
	start('c', 2);
	send('a', 'connected');
	send('b', 'connected');
	advance(100);
	send('c', 'connected');
	send('a', 'disconnected', 1);
	const callId = store.session('b').call_id;
	const summary = store.overview().calls[0];
	assert.equal(summary.participant_count, 2);
	assert.equal(summary.active_count, 2);
	assert.equal(summary.last_seen_at, 1_000_100);
	assert.equal(store.overview(summary.started_at).calls.length, 0);
	store.record({
		sessionId: 'b',
		type: 'warning',
		level: 'warning',
		details: { reason: 'test' },
	});
	store.record({ type: 'server-warning', level: 'warning' });
	const filtered = store.events({ callId, sessionId: 'b', level: 'warning' });
	assert.equal(filtered.length, 1);
	assert.deepEqual(filtered[0].details, { reason: 'test' });
	assert.deepEqual(store.events({ sessionId: "b' OR 1=1 --" }), []);
	assert.deepEqual(
		store.events({
			callId,
			sessionId: 'b',
			level: 'warning',
			before: filtered[0].id,
		}),
		[],
	);
	assert.deepEqual(
		store.events({ level: 'warning', serverOnly: true }).map((e) => e.type),
		['server-warning'],
	);
	assert.equal(store.call('missing'), null);
});

test('sample downsampling keeps the latest complete row in each bucket and inclusive range bounds', (t) => {
	const { store, start, send, advance } = fixture(t);
	start('a');
	send('a', 'connected');
	const samples = Array.from({ length: 1001 }, (_, seq) => ({
		seq,
		at: 10_000 + seq,
		data: { value: seq },
	}));
	store.ingest('a', 1, { events: [], samples });
	store.ingest('a', 1, {
		events: [],
		samples: [{ seq: 1000, at: 99_999, data: { value: -1 } }],
	});
	const rows = store.samples('a');
	assert.equal(rows.length, 251);
	for (let i = 0; i < rows.length; i++) {
		const seq = Math.min(i * 4 + 3, 1000);
		assert.equal(rows[i].sequence_number, seq);
		assert.equal(rows[i].sampled_at, 10_000 + seq);
		assert.deepEqual(rows[i].data, { value: seq });
	}
	assert.equal(store.samples('a', 10_010, 10_019).length, 10);
	assert.deepEqual(store.samples('missing'), []);
	assert.equal(
		store.call(store.session('a').call_id).sessions[0].latest.sequence_number,
		1000,
	);
	for (let i = 0; i < 125; i++) {
		advance(1);
		store.serverSample('server', { value: i });
	}
	assert.equal(store.overview().server.data.value, 124);
	assert.deepEqual(
		store.serverSamples().map((s) => s.data.value),
		Array.from({ length: 120 }, (_, i) => i + 5),
	);
});

test('failed ingestion rolls back the entire Drizzle transaction', (t) => {
	const { store, start } = fixture(t);
	start('a');
	assert.throws(
		() =>
			store.ingest('a', 1, {
				events: [{ seq: 0, at: 1_000_000, type: 'connected', level: 'info' }],
				samples: [
					{
						seq: 0,
						at: 1_000_000,
						get data() {
							throw new Error('serialization failed');
						},
					},
				],
			}),
		/serialization failed/,
	);
	assert.equal(store.session('a').status, 'joining');
	assert.equal(store.session('a').last_sequence, -1);
	assert.equal(store.overview().calls.length, 0);
	assert.deepEqual(store.events({ sessionId: 'a' }), []);
});
