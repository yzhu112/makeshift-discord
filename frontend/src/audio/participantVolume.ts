export function savedParticipantVolume(listenerId: number, identity: string): number {
  try {
    const saved = localStorage.getItem(participantVolumeKey(listenerId, identity));
    const value = saved === null ? 100 : Number(saved);
    return Number.isFinite(value) && value >= 0 && value <= 200 ? value : 100;
  } catch { return 100; }
}

export function participantVolumeKey(listenerId: number, identity: string): string {
  return `voice-participant-volume:${JSON.stringify([listenerId, identity])}`;
}
