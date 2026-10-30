export type MicrophoneIssue = 'blocked' | 'unavailable' | 'error';

export function microphoneIssue(error: unknown): MicrophoneIssue {
  const name = error && typeof error === 'object' && 'name' in error ? error.name : undefined;
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return 'blocked';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'unavailable';
  return 'error';
}

// Joining and receiving audio must not depend on microphone capture or processing.
export async function startMicrophone(
  participant: { setMicrophoneEnabled: (enabled: boolean) => Promise<unknown> },
  configureNoise: () => Promise<void>,
  isCurrent: () => boolean,
): Promise<{ issue: MicrophoneIssue | null; noiseFailed: boolean }> {
  try { await participant.setMicrophoneEnabled(true); }
  catch (error) { return { issue: microphoneIssue(error), noiseFailed: false }; }
  if (!isCurrent()) return { issue: null, noiseFailed: false };
  try { await configureNoise(); }
  catch { return { issue: null, noiseFailed: true }; }
  return { issue: null, noiseFailed: false };
}
