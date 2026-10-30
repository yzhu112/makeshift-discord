import assert from 'node:assert/strict';
import test from 'node:test';
import { muteForMicrophoneTest } from '../src/audio/callTestMute.ts';

for (const initiallyEnabled of [true, false]) {
  test(`restores a microphone that started ${initiallyEnabled ? 'unmuted' : 'muted'} exactly once`, async () => {
    const changes = [], states = [];
    const participant = {
      isMicrophoneEnabled: initiallyEnabled,
      async setMicrophoneEnabled(enabled) { changes.push(enabled); this.isMicrophoneEnabled = enabled; },
    };
    const restore = await muteForMicrophoneTest(participant, () => true, muted => states.push(muted));
    assert.equal(participant.isMicrophoneEnabled, false);
    await restore();
    await restore();
    assert.deepEqual(changes, [false, initiallyEnabled]);
    assert.deepEqual(states, [true, !initiallyEnabled]);
  });
}

test('leaving the call prevents restoring an obsolete microphone', async () => {
  let current = true;
  const changes = [];
  const participant = { isMicrophoneEnabled: true, async setMicrophoneEnabled(enabled) { changes.push(enabled); } };
  const restore = await muteForMicrophoneTest(participant, () => current, () => {});
  current = false;
  await restore();
  assert.deepEqual(changes, [false]);
});

test('mute failure restores the original state and rejects setup', async () => {
  const changes = [];
  const participant = {
    isMicrophoneEnabled: true,
    async setMicrophoneEnabled(enabled) { changes.push(enabled); if (!enabled) throw new Error('mute failed'); },
  };
  await assert.rejects(muteForMicrophoneTest(participant, () => true, () => {}), /mute failed/);
  assert.deepEqual(changes, [false, true]);
});

test('restore failure reports actual muted state instead of showing a false unmute', async () => {
  let muted;
  const participant = {
    isMicrophoneEnabled: true,
    async setMicrophoneEnabled(enabled) {
      if (enabled) throw new Error('unmute failed');
      this.isMicrophoneEnabled = false;
    },
  };
  const restore = await muteForMicrophoneTest(participant, () => true, value => { muted = value; });
  await assert.rejects(restore(), /unmute failed/);
  assert.equal(muted, true);
});
