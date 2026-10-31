import type { RnnoiseWorkletNode } from '@sapphi-red/web-noise-suppressor';
import wasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import simdUrl from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';
import workletUrl from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';
import type { AudioProcessorOptions, Track, TrackProcessor } from 'livekit-client';

/** A dedicated 48 kHz context also resamples microphones running at 44.1 kHz. */
export class RnnoiseProcessor implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  name = 'rnnoise';
  processedTrack?: MediaStreamTrack;
  private context?: AudioContext;
  private source?: MediaStreamAudioSourceNode;
  private node?: RnnoiseWorkletNode;
  private onFailure: () => void;

  constructor(onFailure: () => void) {
    this.onFailure = onFailure;
  }

  async init({ track }: Pick<AudioProcessorOptions, 'track'>) {
    const context = new AudioContext({ sampleRate: 48_000 });
    this.context = context;
    try {
      const { loadRnnoise, RnnoiseWorkletNode } = await import('@sapphi-red/web-noise-suppressor');
      const [wasmBinary] = await Promise.all([
        loadRnnoise({ url: wasmUrl, simdUrl }, { signal: AbortSignal.timeout(10_000) }),
        context.audioWorklet.addModule(workletUrl),
      ]);
      // A stopped/disconnected track must never resurrect a microphone pipeline.
      if (this.context !== context || track.readyState === 'ended') throw new Error('Microphone stopped');
      this.source = context.createMediaStreamSource(new MediaStream([track]));
      this.node = new RnnoiseWorkletNode(context, { wasmBinary, maxChannels: 1 });
      const destination = context.createMediaStreamDestination();
      this.node.onprocessorerror = () => {
        // Keep audio flowing while the caller switches back to browser processing.
        this.source?.disconnect();
        this.source?.connect(destination);
        this.onFailure();
      };
      this.source.connect(this.node);
      this.node.connect(destination);
      this.processedTrack = destination.stream.getAudioTracks()[0];
      // Do not stall joining on an autoplay-blocked context.
      await Promise.race([context.resume(), new Promise<void>((resolve) => setTimeout(resolve, 1_000))]);
      if (this.context !== context || context.state !== 'running') throw new Error('Audio processing unavailable');
    } catch (error) {
      await this.destroy();
      throw error;
    }
  }

  async restart(options: AudioProcessorOptions) {
    await this.destroy();
    await this.init(options);
  }

  async destroy() {
    const context = this.context;
    this.context = undefined;
    if (this.node) {
      this.node.onprocessorerror = null;
      this.node.disconnect();
      this.node.destroy();
      this.node = undefined;
    }
    this.source?.disconnect();
    this.source = undefined;
    this.processedTrack?.stop();
    this.processedTrack = undefined;
    if (context && context.state !== 'closed') await context.close();
  }
}
