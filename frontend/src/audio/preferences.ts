export type NoiseMode = 'rnnoise' | 'browser';
const NOISE_STORAGE_KEY = 'voice-noise-mode';

export function savedNoiseMode(): NoiseMode {
  try { return localStorage.getItem(NOISE_STORAGE_KEY) === 'browser' ? 'browser' : 'rnnoise'; }
  catch { return 'rnnoise'; }
}

export function saveNoiseMode(mode: NoiseMode) {
  try { localStorage.setItem(NOISE_STORAGE_KEY, mode); } catch { /* Optional preference. */ }
}

export const captureOptions = (mode: NoiseMode) => ({
  echoCancellation: true,
  noiseSuppression: mode === 'browser',
  voiceIsolation: mode === 'browser',
  channelCount: 1,
});
