/** Uses the call's playback context so Enable sound also unlocks these tones. */
export class PresenceSounds {
  readonly context: AudioContext | undefined;
  private nextTime = 0;
  private closed = false;
  private voices = new Map<OscillatorNode, GainNode>();

  constructor() {
    try { this.context = new AudioContext(); } catch { /* Keep joining possible without Web Audio. */ }
  }

  play(kind: 'join' | 'leave') {
    const context = this.context;
    // Never queue old notifications while playback is blocked by the browser.
    if (this.closed || !context || context.state !== 'running') return;
    const start = Math.max(context.currentTime, this.nextTime);
    this.nextTime = start + 0.24;
    const notes = kind === 'join' ? [520, 780] : [780, 520];
    for (const [index, frequency] of notes.entries()) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const at = start + index * 0.1;
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.06, at + 0.012);
      gain.gain.linearRampToValueAtTime(0, at + 0.1);
      oscillator.connect(gain);
      gain.connect(context.destination);
      this.voices.set(oscillator, gain);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
        this.voices.delete(oscillator);
      };
      oscillator.start(at);
      oscillator.stop(at + 0.11);
    }
  }

  silence() {
    for (const [oscillator, gain] of this.voices) {
      oscillator.onended = null;
      oscillator.stop();
      oscillator.disconnect();
      gain.disconnect();
    }
    this.voices.clear();
    this.nextTime = 0;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.silence();
    void this.context?.close().catch(() => {});
  }
}
