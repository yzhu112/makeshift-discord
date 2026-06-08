import { Track } from 'livekit-client';
import type { AudioProcessorOptions, TrackProcessor } from 'livekit-client';

// Runs inside an AudioWorklet scope (plain JS, no imports allowed).
// Estimates the noise floor from quiet periods, then gates anything just above it.
const WORKLET = `
class NoiseGateProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.noiseFloor = 0.005;   // initial guess, overwritten quickly
    this.smoothed = 0.005;     // smoothed RMS for floor tracking
  }

  process(inputs, outputs) {
    const inp = inputs[0]?.[0];
    const out = outputs[0]?.[0];
    if (!inp || !out) return true;

    let sum = 0;
    for (let i = 0; i < inp.length; i++) sum += inp[i] * inp[i];
    const rms = Math.sqrt(sum / inp.length);

    // Slowly track the minimum RMS — that's the noise floor.
    // Rise fast (0.3) so we don't track speech as the floor,
    // fall slow (0.001) so the floor estimate decays toward silence.
    if (rms < this.smoothed) {
      this.smoothed += (rms - this.smoothed) * 0.001; // decay toward lower values slowly
    } else {
      this.smoothed += (rms - this.smoothed) * 0.3;   // track rises fast (speech)
    }

    // Floor = the smoothed minimum. Gate threshold = floor * 1.5.
    this.noiseFloor = Math.min(this.noiseFloor, this.smoothed) * 0.9995 + this.smoothed * 0.0005;
    const threshold = this.noiseFloor * 1.5;

    if (rms < threshold) out.fill(0);
    else out.set(inp);

    return true;
  }
}
registerProcessor('noise-gate', NoiseGateProcessor);
`;

export class NoiseGate
  implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions>
{
  name = 'noise-gate';
  processedTrack?: MediaStreamTrack;

  private workletNode?: AudioWorkletNode;
  private sourceNode?: MediaStreamAudioSourceNode;
  private destinationNode?: MediaStreamAudioDestinationNode;

  async init({ audioContext, track }: AudioProcessorOptions) {
    const blob = new Blob([WORKLET], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    await audioContext.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);

    this.sourceNode = audioContext.createMediaStreamSource(
      new MediaStream([track]),
    );
    this.workletNode = new AudioWorkletNode(audioContext, 'noise-gate');
    this.destinationNode = audioContext.createMediaStreamDestination();

    this.sourceNode.connect(this.workletNode);
    this.workletNode.connect(this.destinationNode);

    this.processedTrack = this.destinationNode.stream.getAudioTracks()[0];
  }

  async restart(opts: AudioProcessorOptions) {
    await this.destroy();
    await this.init(opts);
  }

  async destroy() {
    this.sourceNode?.disconnect();
    this.workletNode?.disconnect();
    this.destinationNode?.disconnect();
    this.sourceNode = undefined;
    this.workletNode = undefined;
    this.destinationNode = undefined;
    this.processedTrack = undefined;
  }
}
