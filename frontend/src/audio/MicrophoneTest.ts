import { RnnoiseProcessor } from '../room/rnnoise';
import { captureOptions, type NoiseMode } from './preferences';

type Callbacks = {
  onLevel: (level: number) => void;
  onMode: (mode: NoiseMode) => void;
  onError: (error: unknown) => void;
};

/** Local playback only. Never publishes audio or stops a call's microphone. */
export class MicrophoneTest {
  private stopped = false;
  private restoreCall?: () => Promise<void>;
  private context?: AudioContext;
  private input?: MediaStreamTrack;
  private processor?: RnnoiseProcessor;
  private source?: MediaStreamAudioSourceNode;
  private analyser?: AnalyserNode;
  private ready = false;
  private processorFailed = false;
  private fallingBack = false;
  private gain?: GainNode;
  private timer?: ReturnType<typeof setInterval>;
  private callbacks: Callbacks;

  constructor(callbacks: Callbacks) { this.callbacks = callbacks; }

  async start(mode: NoiseMode, callTrack?: MediaStreamTrack, prepareCall?: () => Promise<() => Promise<void>>) {
    try {
      // Create/resume playback within the button's user gesture (including Safari).
      const context = new AudioContext();
      this.context = context;
      const resumed = Promise.race([context.resume(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Playback unavailable')), 2_000))]);
      // Permission may remain pending longer than the resume request.
      void resumed.catch(() => {});
      if (prepareCall) {
        const restore = await prepareCall();
        if (this.stopped) { await restore(); return; }
        this.restoreCall = restore;
      }
      if (callTrack) {
        this.input = callTrack.clone();
      } else {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: captureOptions(mode) });
        if (this.stopped) { stream.getTracks().forEach(track => track.stop()); return; }
        this.input = stream.getAudioTracks()[0];
      }
      const input = this.input;
      if (!input || input.readyState === 'ended') throw new Error('Microphone unavailable');
      input.onended = () => this.fail(new Error('Microphone disconnected'));
      await resumed;
      if (this.stopped) return;
      this.gain = context.createGain();
      this.gain.gain.value = 0.5;
      this.gain.connect(context.destination);
      let output = input;
      if (!callTrack && mode === 'rnnoise') {
        const processor = new RnnoiseProcessor(() => {
          this.processorFailed = true;
          if (this.ready) void this.fallback().catch(error => this.fail(error));
        });
        this.processor = processor;
        try {
          await processor.init({ track: input });
          output = processor.processedTrack!;
        } catch {
          if (this.stopped) return;
          await processor.destroy();
          this.processor = undefined;
          await input.applyConstraints(captureOptions('browser'));
          mode = 'browser';
        }
      }
      if (this.stopped) return;
      this.ready = true;
      if (this.processorFailed) await this.fallback();
      else { this.connectOutput(output); this.callbacks.onMode(mode); }
    } catch (error) {
      if (!this.stopped) this.fail(error);
    }
  }

  private connectOutput(track: MediaStreamTrack) {
    const context = this.context!;
    this.source?.disconnect();
    this.analyser?.disconnect();
    clearInterval(this.timer);
    const analyser = context.createAnalyser();
    this.analyser = analyser;
    analyser.fftSize = 256;
    this.source = context.createMediaStreamSource(new MediaStream([track]));
    this.source.connect(analyser);
    analyser.connect(this.gain!);
    const samples = new Float32Array(analyser.fftSize);
    this.timer = setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
      this.callbacks.onLevel(Math.min(100, Math.max(0, (20 * Math.log10(rms || 0.00001) + 60) / 60 * 100)));
    }, 100);
  }

  private async fallback() {
    if (this.stopped || !this.input || this.fallingBack) return;
    this.fallingBack = true;
    await this.processor?.destroy();
    this.processor = undefined;
    if (this.stopped) return;
    await this.input.applyConstraints(captureOptions('browser'));
    if (this.stopped) return;
    this.connectOutput(this.input);
    this.callbacks.onMode('browser');
  }

  private fail(error: unknown) {
    if (this.stopped) return;
    this.callbacks.onError(error);
    this.stop();
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    clearInterval(this.timer);
    this.source?.disconnect();
    this.analyser?.disconnect();
    this.gain?.disconnect();
    if (this.input) { this.input.onended = null; this.input.stop(); }
    void this.processor?.destroy().catch(() => {});
    if (this.context && this.context.state !== 'closed') void this.context.close().catch(() => {});
    const restore = this.restoreCall;
    this.restoreCall = undefined;
    // Local capture is stopped before anyone in the call can hear us again.
    void restore?.().catch(() => { /* The call controller reports restore failures. */ });
  }
}
