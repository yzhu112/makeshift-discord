import assert from 'node:assert/strict';
import test from 'node:test';
import { applySync } from '../../frontend/src/diagnostics/sync.ts';
import { createSync, difference } from '../src/diagnostics/sync.js';

test('diff reconstructs added/changed/pruned rows, ordering, nested properties, and null values', () => {
	const before = {
		sessions: [
			{ id: 'a', state: 'joined' },
			{ id: 'b', state: 'joined' },
		],
		info: { nested: { old: true }, nullable: { x: 1 } },
		tags: ['old'],
	};
	const after = {
		sessions: [
			{ id: 'c', state: 'joined' },
			{ id: 'b', state: 'left' },
		],
		info: { nested: { new: true }, nullable: null },
		tags: [],
	};
	const changes = difference(before, after);
	assert.deepEqual(applySync(before, { revision: 'next', changes }), after);
	assert.equal(before.sessions[1].state, 'joined');
	assert.deepEqual(applySync(after, { revision: 'next', changes: [] }), after);
});

test('history delta only includes new data, even as the rolling window removes its oldest row', () => {
	const sync = createSync();
	const before = Array.from({ length: 150 }, (_, id) => ({
		id,
		data: 'x'.repeat(1800),
	}));
	const first = sync('/samples/a', undefined, before);
	const after = [...before.slice(1), { id: 150, data: 'new'.repeat(600) }];
	const second = sync('/samples/a', first.revision, after);
	assert.equal(second.changes[0].upsert.length, 1);
	assert.deepEqual(second.changes[0].remove, ['0']);
	assert.deepEqual(applySync(first.data, second), after);
	assert.ok(
		JSON.stringify(second).length < JSON.stringify(after).length * 0.02,
	);
	assert.deepEqual(sync('/samples/a', second.revision, after).changes, []);
});

test('unknown revisions, different filters and evicted snapshots safely return full data', () => {
	const sync = createSync({ budget: 1000, maxEntries: 1 });
	const first = sync('/a', undefined, { body: 'x'.repeat(200) });
	assert.ok('data' in sync('/b', first.revision, { body: 'x'.repeat(200) }));
	assert.ok('data' in sync('/a', first.revision, { body: 'x'.repeat(200) }));
	assert.ok('data' in sync('/a', 'missing', { body: 'x'.repeat(200) }));
	assert.ok(
		'data' in createSync()('/a', first.revision, { body: 'x'.repeat(200) }),
	);
});

test('empty collections and non-ID arrays synchronize without ambiguity', () => {
	for (const [before, after] of [
		[[], [{ id: 1 }]],
		[[{ id: 1 }], []],
		[
			[1, 2],
			[2, 3],
		],
		[{ a: 1 }, {}],
		[null, { a: 1 }],
	]) {
		assert.deepEqual(
			applySync(before, { revision: 'r', changes: difference(before, after) }),
			after,
		);
	}
});
