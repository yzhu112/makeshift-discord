/** Keep selected tiles in join order so a new speaker doesn't shuffle every card. */
export function visibleParticipants<T extends { identity: string }>(
  participants: T[], active: ReadonlySet<string>, lastSpoke: ReadonlyMap<string, number>,
): T[] {
  if (participants.length <= 9) return participants;
  const selected = new Set([...participants].sort((a, b) =>
    Number(active.has(b.identity)) - Number(active.has(a.identity)) ||
    (lastSpoke.get(b.identity) ?? -1) - (lastSpoke.get(a.identity) ?? -1),
  ).slice(0, 8).map(p => p.identity));
  return participants.filter(p => selected.has(p.identity));
}

export function participantLayout(count: number, width: number) {
  const preferred = count <= 1 ? 1 : count <= 4 ? 2 : 3;
  const columns = Math.min(preferred, Math.max(1, Math.floor((width + 12) / 172)));
  const rows = Math.max(1, Math.ceil(count / columns));
  const remainder = count % columns;
  return {
    columns, rows,
    // Two CSS tracks per card allow half-card offsets for centered final rows.
    starts: Array.from({ length: count }, (_, index) =>
      1 + (index % columns) * 2 +
      (remainder && index >= count - remainder ? columns - remainder : 0)),
  };
}
