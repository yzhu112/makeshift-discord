import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { clean, createDiagnosticsStore } from '../src/diagnostics/store.js';

function fixture(t, options = {}) {
	const dir = mkdtempSync(join(tmpdir(), 'voice-diag-test-'));
	let clock = 1_000_000;
	const store = createDiagnosticsStore(join(dir, 'diagnostics.db'), {
		now: () => clock,
		...options,
	});
	t.after(() => {
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
	return { store, start, send, advance: (ms) => (clock += ms) };
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
	const { store, start, advance } = fixture(t, { budget });
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
		store.db
			.prepare('SELECT MIN(sequence_number) AS n FROM participant_samples')
			.get().n > 0,
	);
	assert.equal(
		store.db
			.prepare('SELECT MAX(sequence_number) AS n FROM participant_samples')
			.get().n,
		1199,
	);
	assert.ok(store.session('a'));
	assert.equal(store.db.pragma('quick_check', { simple: true }), 'ok');
});

test('event-only load is bounded too', (t) => {
	const { store } = fixture(t, { budget: 1024 * 1024 });
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
		store.db.prepare('SELECT MIN(occurred_at) AS n FROM events').get().n > 0,
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
