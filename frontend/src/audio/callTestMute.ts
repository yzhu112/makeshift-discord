type Microphone = {
  isMicrophoneEnabled: boolean;
  setMicrophoneEnabled: (enabled: boolean) => Promise<unknown>;
};

/** Acquire call silence before local capture, restoring the original state exactly once. */
export async function muteForMicrophoneTest(
  participant: Microphone,
  isCurrent: () => boolean,
  onMuted: (muted: boolean) => void,
) {
  const wasEnabled = participant.isMicrophoneEnabled;
  let restored = false;
  const restore = async () => {
    if (restored) return;
    restored = true;
    if (!isCurrent()) return;
    try {
      await participant.setMicrophoneEnabled(wasEnabled);
    } finally {
      if (isCurrent()) onMuted(!participant.isMicrophoneEnabled);
    }
  };
  try {
    await participant.setMicrophoneEnabled(false);
    if (isCurrent()) onMuted(true);
  } catch (error) {
    await restore();
    throw error;
  }
  return restore;
}
