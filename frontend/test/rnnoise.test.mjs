import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { createServer } from 'vite';

let server;
let RnnoiseProcessor;
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
    async resume() { this.state = 'running'; }
    async close() { this.state = 'closed'; }
  };
  globalThis.MediaStream = class { constructor(tracks) { this.tracks = tracks; } };
  globalThis.fetch = async () => ({ arrayBuffer: async () => new ArrayBuffer(8) });
  server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, ws: false, hmr: false, watch: null } });
  ({ RnnoiseProcessor } = await server.ssrLoadModule('/src/room/rnnoise.ts'));
});
after(async () => { await server?.close(); Object.assign(globalThis, original); });
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
