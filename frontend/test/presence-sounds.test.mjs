import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { PresenceSounds } from '../src/audio/PresenceSounds.ts';

const original = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
class Node {
  frequency = { value: 0 };
  gain = { setValueAtTime() {}, linearRampToValueAtTime() {} };
  connect() {}
  disconnect() { this.disconnected = true; }
  start(at) { this.startedAt = at; }
  stop(at) { this.stoppedAt = at; }
}
class Context {
  state = 'running';
  currentTime = 10;
  destination = {};
  oscillators = [];
  createOscillator() { const node = new Node(); this.oscillators.push(node); return node; }
  createGain() { return new Node(); }
  async close() { this.state = 'closed'; }
}
Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: Context });
after(() => {
  if (original) Object.defineProperty(globalThis, 'AudioContext', original);
  else delete globalThis.AudioContext;
});

test('join rises and leave falls, with separate notifications played sequentially', () => {
  const sounds = new PresenceSounds();
  sounds.play('join');
  sounds.play('leave');
  const nodes = sounds.context.oscillators;
  assert.deepEqual(nodes.map(node => node.frequency.value), [520, 780, 780, 520]);
  assert.ok(nodes[2].startedAt > nodes[1].stoppedAt);
  sounds.close();
});

test('blocked playback does not queue stale notifications', () => {
  const sounds = new PresenceSounds();
  sounds.context.state = 'suspended';
  sounds.play('join');
  assert.equal(sounds.context.oscillators.length, 0);
  sounds.context.state = 'running';
  sounds.play('leave');
  assert.equal(sounds.context.oscillators.length, 2);
  assert.equal(sounds.context.oscillators[0].startedAt, sounds.context.currentTime);
  sounds.close();
});

test('reconnection clears pending tones, and closing releases playback resources', () => {
  const sounds = new PresenceSounds();
  sounds.play('join');
  sounds.play('leave');
  const pending = [...sounds.context.oscillators];
  sounds.silence();
  assert.ok(pending.every(node => node.disconnected && node.stoppedAt === undefined));
  sounds.play('join');
  assert.equal(sounds.context.oscillators[4].startedAt, sounds.context.currentTime);
  sounds.close();
  sounds.close();
  sounds.play('leave');
  assert.equal(sounds.context.state, 'closed');
  assert.equal(sounds.context.oscillators.length, 6);
});
