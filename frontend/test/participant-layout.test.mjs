import assert from 'node:assert/strict';
import { test } from 'node:test';
import { participantLayout, visibleParticipants } from '../src/room/participantLayout.ts';

const participants = Array.from({ length: 12 }, (_, index) => ({ identity: String(index) }));

test('one through nine use the requested rows with centered incomplete rows', () => {
  const expected = [[1], [2], [2, 1], [2, 2], [3, 2], [3, 3], [3, 3, 1], [3, 3, 2], [3, 3, 3]];
  for (let count = 1; count <= 9; count++) {
    const { columns, rows, starts } = participantLayout(count, 1100);
    const sizes = Array.from({ length: rows }, (_, row) => Math.min(columns, count - row * columns));
    assert.deepEqual(sizes, expected[count - 1]);
    const lastRow = starts.slice((rows - 1) * columns);
    assert.equal(lastRow[0] - 1, columns * 2 - (lastRow.at(-1) + 1));
  }
});

test('narrow screens reduce columns without losing cards', () => {
  assert.equal(participantLayout(9, 340).columns, 2);
  assert.equal(participantLayout(9, 260).columns, 1);
  assert.equal(participantLayout(9, 0).rows, 9);
});

test('up to nine includes everyone in stable order', () => {
  const nine = participants.slice(0, 9);
  assert.deepEqual(visibleParticipants(nine, new Set(['8']), new Map()), nine);
});

test('ten or more selects eight recent speakers with active speakers first in priority', () => {
  const recent = new Map(participants.map((p, index) => [p.identity, index]));
  const selected = visibleParticipants(participants, new Set(['0']), recent);
  assert.equal(selected.length, 8);
  assert.deepEqual(selected.map(p => p.identity), ['0', '5', '6', '7', '8', '9', '10', '11']);
});

test('silent rooms fall back to join order and departed identities cannot occupy slots', () => {
  const stale = new Map([['departed', 999]]);
  assert.deepEqual(visibleParticipants(participants, new Set(), stale), participants.slice(0, 8));
});

test('changing speaker priority preserves positions when the selected group is unchanged', () => {
  const recent = new Map(participants.map((p, index) => [p.identity, index]));
  assert.deepEqual(visibleParticipants(participants, new Set(['11']), recent),
    visibleParticipants(participants, new Set(['7']), recent));
});
