import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { participantVolumeKey, savedParticipantVolume } from '../src/audio/participantVolume.ts';

const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const saved = new Map();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: key => saved.get(key) ?? null,
} });
after(() => {
  if (original) Object.defineProperty(globalThis, 'localStorage', original);
  else delete globalThis.localStorage;
});

test('defaults to normal volume and restores mute, attenuation, and boost', () => {
  const key = participantVolumeKey(1, 'speaker');
  assert.equal(savedParticipantVolume(1, 'speaker'), 100);
  for (const volume of [0, 50, 100, 150, 200]) {
    saved.set(key, String(volume));
    assert.equal(savedParticipantVolume(1, 'speaker'), volume);
  }
  assert.equal(savedParticipantVolume(2, 'speaker'), 100);
  assert.equal(savedParticipantVolume(1, 'someone else'), 100);
});

test('invalid or inaccessible preferences fall back to normal volume', () => {
  for (const value of ['NaN', 'Infinity', '-1', '201', 'bad data']) {
    saved.set(participantVolumeKey(1, 'speaker'), value);
    assert.equal(savedParticipantVolume(1, 'speaker'), 100);
  }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('blocked'); } });
  assert.equal(savedParticipantVolume(1, 'speaker'), 100);
});
