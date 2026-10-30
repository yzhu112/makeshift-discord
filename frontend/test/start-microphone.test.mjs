import assert from 'node:assert/strict';
import test from 'node:test';
import { startMicrophone } from '../src/audio/startMicrophone.ts';

for (const [name, issue] of [['NotAllowedError', 'blocked'], ['NotFoundError', 'unavailable'], ['NotReadableError', 'error']]) {
  test(`${name} allows the caller to continue without configuring microphone processing`, async () => {
    const result = await startMicrophone({
      async setMicrophoneEnabled() { throw Object.assign(new Error('capture failed'), { name }); },
    }, async () => assert.fail('processing requires a microphone'), () => true);
    assert.deepEqual(result, { issue, noiseFailed: false });
  });
}

test('retry after permission is granted enables the mic and configures processing', async () => {
  let allowed = false;
  let configured = 0;
  const participant = {
    async setMicrophoneEnabled(enabled) {
      assert.equal(enabled, true);
      if (!allowed) throw Object.assign(new Error('blocked'), { name: 'NotAllowedError' });
    },
  };
  const configure = async () => { configured++; };
  assert.equal((await startMicrophone(participant, configure, () => true)).issue, 'blocked');
  allowed = true;
  assert.deepEqual(await startMicrophone(participant, configure, () => true), { issue: null, noiseFailed: false });
  assert.equal(configured, 1);
});

test('noise processing failure is separate from microphone access failure', async () => {
  const result = await startMicrophone({ async setMicrophoneEnabled() {} }, async () => {
    throw new Error('processor failed');
  }, () => true);
  assert.deepEqual(result, { issue: null, noiseFailed: true });
});

test('leaving while the permission prompt is pending skips processing', async () => {
  let current = true;
  let allow;
  const permission = new Promise(resolve => { allow = resolve; });
  const operation = startMicrophone({ setMicrophoneEnabled: () => permission },
    async () => assert.fail('left room must not configure processing'), () => current);
  current = false;
  allow();
  await operation;
});
