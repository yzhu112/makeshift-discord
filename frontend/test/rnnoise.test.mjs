import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { createServer } from 'vite';

let server;
let RnnoiseProcessor;
let MicrophoneTest;
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
let contexts;
let nodes;
let moduleError;
let loadModule;
const original = Object.fromEntries(['AudioContext', 'AudioWorkletNode', 'MediaStream', 'fetch'].map(key => [key, globalThis[key]]));
class Node {
  connections = [];
  connect(node) { this.connections.push(node); }
  disconnect() { this.connections = []; }
}
before(async () => {
  globalThis.AudioWorkletNode = class extends Node {
    port = { postMessage: message => { this.destroyed = message === 'destroy'; } };
    constructor() { super(); nodes.push(this); }
  };
  globalThis.AudioContext = class {
    state = 'suspended';
    audioWorklet = { addModule: async () => { if (moduleError) throw moduleError; await loadModule?.(); } };
    constructor(options) { this.options = options; contexts.push(this); }
    createMediaStreamSource(stream) { this.input = stream; return this.source = new Node(); }
    createMediaStreamDestination() {
      this.output = { stopped: false, stop() { this.stopped = true; } };
      return this.destination = { stream: { getAudioTracks: () => [this.output] } };
    }
    createGain() { const node = new Node(); node.gain = { value: 1 }; return node; }
    createAnalyser() { const node = new Node(); node.getFloatTimeDomainData = samples => samples.fill(0.2); return node; }
    async resume() { this.state = 'running'; }
    async close() { this.state = 'closed'; }
  };
  globalThis.MediaStream = class { constructor(tracks) { this.tracks = tracks; } };
  globalThis.fetch = async () => ({ arrayBuffer: async () => new ArrayBuffer(8) });
  server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, ws: false, hmr: false, watch: null } });
  ({ RnnoiseProcessor } = await server.ssrLoadModule('/src/room/rnnoise.ts'));
  ({ MicrophoneTest } = await server.ssrLoadModule('/src/audio/MicrophoneTest.ts'));
});
after(async () => { await server?.close(); Object.assign(globalThis, original); if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator); else delete globalThis.navigator; });
beforeEach(() => { contexts = []; nodes = []; moduleError = undefined; loadModule = undefined; });
const options = () => ({ track: { readyState: 'live' } });

test('processes mono at 48 kHz and releases owned resources without stopping the input', async () => {
  const input = options();
  const processor = new RnnoiseProcessor(() => assert.fail('unexpected failure'));
  await processor.init(input);
  const context = contexts[0];
  assert.equal(context.options.sampleRate, 48_000);
  assert.deepEqual(context.input.tracks, [input.track]);
  assert.deepEqual(context.source.connections, [nodes[0]]);
  assert.deepEqual(nodes[0].connections, [context.destination]);
  assert.equal(processor.processedTrack, context.output);
  await processor.destroy();
  await processor.destroy();
  assert.equal(context.state, 'closed');
  assert.equal(context.output.stopped, true);
  assert.equal(nodes[0].destroyed, true);
  assert.equal(processor.processedTrack, undefined);
});

test('failed worklet loading closes its context so browser fallback can proceed', async () => {
  moduleError = new Error('worklet blocked');
  const processor = new RnnoiseProcessor(() => {});
  await assert.rejects(processor.init(options()), /worklet blocked/);
  assert.equal(contexts[0].state, 'closed');
  assert.equal(processor.processedTrack, undefined);
});

test('worklet crash keeps audio flowing and requests fallback', async () => {
  let failures = 0;
  const processor = new RnnoiseProcessor(() => failures++);
  await processor.init(options());
  nodes[0].onprocessorerror();
  assert.equal(failures, 1);
  assert.deepEqual(contexts[0].source.connections, [contexts[0].destination]);
  await processor.destroy();
  assert.equal(nodes[0].onprocessorerror, null);
});

test('restart replaces and cleans up the previous pipeline', async () => {
  const processor = new RnnoiseProcessor(() => {});
  await processor.init(options());
  const oldTrack = processor.processedTrack;
  await processor.restart(options());
  assert.equal(contexts[0].state, 'closed');
  assert.equal(oldTrack.stopped, true);
  assert.notEqual(processor.processedTrack, oldTrack);
  await processor.destroy();
});

test('leaving during initialization does not recreate a stopped pipeline', async () => {
  let release;
  loadModule = () => new Promise(resolve => { release = resolve; });
  const processor = new RnnoiseProcessor(() => {});
  const pending = processor.init(options());
  while (!release) await new Promise(resolve => setImmediate(resolve));
  await processor.destroy();
  release();
  await assert.rejects(pending, /Microphone stopped/);
  assert.equal(nodes.length, 0);
  assert.equal(contexts[0].state, 'closed');
});

const fakeTrack = () => ({
  readyState: 'live', stopped: false,
  stop() { this.stopped = true; this.readyState = 'ended'; },
  async applyConstraints(value) { this.constraints = value; },
});
const setCapture = fn => Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: fn } } });
const callbacks = (overrides = {}) => ({ onMode() {}, onLevel() {}, onError: error => { throw error; }, ...overrides });

test('local mic test uses RNNoise and releases capture and playback on stop', async () => {
  const input = fakeTrack();
  let constraints, actual;
  setCapture(async value => { constraints = value; return { getAudioTracks: () => [input] }; });
  const monitor = new MicrophoneTest(callbacks({ onMode: mode => { actual = mode; } }));
  await monitor.start('rnnoise');
  assert.equal(constraints.audio.noiseSuppression, false);
  assert.equal(actual, 'rnnoise');
  monitor.stop();
  assert.equal(input.stopped, true);
  assert.ok(contexts.every(context => context.state === 'closed'));
});

test('closing while microphone permission is pending stops the late stream', async () => {
  let release;
  const input = fakeTrack();
  setCapture(() => new Promise(resolve => { release = resolve; }));
  const monitor = new MicrophoneTest(callbacks({ onMode: () => assert.fail('closed test became active') }));
  const pending = monitor.start('browser');
  monitor.stop();
  release({ getTracks: () => [input], getAudioTracks: () => [input] });
  await pending;
  assert.equal(input.stopped, true);
  assert.equal(contexts[0].state, 'closed');
});

test('call monitoring uses a clone and never stops the published track', async () => {
  const input = fakeTrack();
  const clone = fakeTrack();
  input.clone = () => clone;
  setCapture(() => assert.fail('call monitoring must not reacquire microphone'));
  const monitor = new MicrophoneTest(callbacks());
  await monitor.start('rnnoise', input);
  assert.equal(nodes.length, 0, 'do not process already processed call audio twice');
  monitor.stop();
  assert.equal(clone.stopped, true);
  assert.equal(input.stopped, false);
});

test('local mic test falls back to browser suppression when RNNoise loading fails', async () => {
  moduleError = new Error('blocked worklet');
  const input = fakeTrack();
  let actual;
  setCapture(async () => ({ getAudioTracks: () => [input] }));
  const monitor = new MicrophoneTest(callbacks({ onMode: mode => { actual = mode; } }));
  await monitor.start('rnnoise');
  assert.equal(actual, 'browser');
  assert.equal(input.constraints.noiseSuppression, true);
  monitor.stop();
});

test('permission failure reports an error and closes playback context', async () => {
  const denied = new Error('Permission denied');
  let failure;
  setCapture(async () => { throw denied; });
  const monitor = new MicrophoneTest(callbacks({ onError: error => { failure = error; } }));
  await monitor.start('browser');
  assert.equal(failure, denied);
  assert.equal(contexts[0].state, 'closed');
});

test('call is muted before local capture and restored after capture stops', async () => {
  const events = [];
  const input = fakeTrack();
  const stop = input.stop.bind(input);
  input.stop = () => { events.push('stop capture'); stop(); };
  setCapture(async () => { events.push('capture'); return { getAudioTracks: () => [input] }; });
  const monitor = new MicrophoneTest(callbacks());
  await monitor.start('browser', undefined, async () => {
    events.push('mute');
    return async () => { events.push('restore'); };
  });
  monitor.stop();
  monitor.stop();
  assert.deepEqual(events, ['mute', 'capture', 'stop capture', 'restore']);
});

test('closing during pending call mute restores afterward without capturing', async () => {
  let release;
  let restored = 0;
  setCapture(() => assert.fail('cancelled test acquired microphone'));
  const monitor = new MicrophoneTest(callbacks());
  const pending = monitor.start('browser', undefined, () => new Promise(resolve => { release = resolve; }));
  monitor.stop();
  release(async () => { restored++; });
  await pending;
  assert.equal(restored, 1);
});

test('capture failure after auto mute restores the call', async () => {
  let restored = 0, errors = 0;
  setCapture(async () => { throw new Error('denied'); });
  const monitor = new MicrophoneTest(callbacks({ onError: () => { errors++; } }));
  await monitor.start('browser', undefined, async () => async () => { restored++; });
  assert.equal(errors, 1);
  assert.equal(restored, 1);
});
