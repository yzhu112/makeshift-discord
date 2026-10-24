import { Room, Track } from 'livekit-client';
import type { AudioStats, Metrics, Transport } from './types';

// The SDK exposes track stats publicly, but not pre-track ICE state. Keep its
// optional internal adapter here; fall back to track stats if its shape changes.
type TransportAdapter = {
  getStats?: () => Promise<RTCStatsReport>;
  _pc?: RTCPeerConnection;
};
export function connections(room: Room): [string, TransportAdapter][] {
  const manager = (
    room as unknown as {
      engine?: {
        pcManager?: {
          publisher?: TransportAdapter;
          subscriber?: TransportAdapter;
        };
      };
    }
  ).engine?.pcManager;
  return Object.entries(
    manager
      ? { publisher: manager.publisher, subscriber: manager.subscriber }
      : {},
  ).filter((entry): entry is [string, TransportAdapter] => !!entry[1]);
}
type Stat = Record<string, any>; // Browser RTCStats dictionaries vary by browser/version.
const finite = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const ms = (v: unknown) => (finite(v) === null ? null : Number(v) * 1000);
export function transportPath(candidate: Stat): string {
  if (candidate.relayProtocol === 'tls' || candidate.url?.startsWith('turns:'))
    return 'TURN/TLS';
  if (candidate.candidateType === 'relay')
    return candidate.relayProtocol === 'tcp'
      ? 'TURN/TCP'
      : candidate.relayProtocol === 'udp'
        ? 'TURN/UDP'
        : 'TURN';
  return candidate.protocol === 'udp'
    ? 'Direct UDP'
    : candidate.protocol === 'tcp'
      ? 'Direct TCP'
      : 'Unknown';
}
export class StatsCollector {
  private previous = new Map<string, Stat>();
  private failedPairs = new Set<string>();
  private listeners = new Map<RTCPeerConnection, (() => void)[]>();
  private event: (
    type: string,
    message: string,
    details?: Record<string, unknown>,
    level?: 'info' | 'warning' | 'error',
  ) => void;
  constructor(event: StatsCollector['event']) {
    this.event = event;
  }
  bind(room: Room) {
    for (const [role, adapter] of connections(room)) {
      const pc = adapter._pc;
      if (!pc || this.listeners.has(pc)) continue;
      const disposers: (() => void)[] = [];
      const on = (type: string, fn: EventListener) => {
        pc.addEventListener(type, fn);
        disposers.push(() => pc.removeEventListener(type, fn));
      };
      on('iceconnectionstatechange', () =>
        this.event(
          'ice_state',
          `${role}: ICE ${pc.iceConnectionState}`,
          { role, state: pc.iceConnectionState },
          pc.iceConnectionState === 'failed' ? 'error' : 'info',
        ),
      );
      on('connectionstatechange', () =>
        this.event('peer_connection_state', `${role}: ${pc.connectionState}`, {
          role,
          state: pc.connectionState,
        }),
      );
      on('icecandidateerror', (e) => {
        const error = e as RTCPeerConnectionIceErrorEvent;
        this.event(
          'candidate_gathering_error',
          error.errorText || 'ICE candidate gathering error',
          { role, code: error.errorCode, url: error.url?.split('?')[0] },
          'warning',
        );
      });
      this.listeners.set(pc, disposers);
    }
  }
  async sample(room: Room): Promise<Metrics> {
    this.bind(room);
    let reports: [string, RTCStatsReport][] = [];
    for (const [role, adapter] of connections(room)) {
      try {
        if (adapter.getStats) reports.push([role, await adapter.getStats()]);
      } catch {
        /* Closed/replaced transport. */
      }
    }
    if (!reports.length) {
      const tracks = [
        ...room.localParticipant.trackPublications.values(),
        ...[...room.remoteParticipants.values()].flatMap((p) => [
          ...p.trackPublications.values(),
        ]),
      ];
      for (const pub of tracks)
        try {
          const report = await pub.track?.getRTCStatsReport();
          if (report) reports.push([pub.trackSid, report]);
        } catch {
          /* Not ready. */
        }
    }
    const transports: Transport[] = [],
      incomingAudio: AudioStats[] = [],
      outgoingAudio: AudioStats[] = [];
    const next = new Map<string, Stat>();
    for (const [role, report] of reports) {
      const stats = new Map<string, Stat>();
      report.forEach((s) => stats.set(s.id, s));
      for (const s of stats.values()) {
        const key = `${role}:${s.id}`;
        const old = this.previous.get(key);
        next.set(key, s);
        const delta = (field: string) =>
          old &&
          finite(s[field]) !== null &&
          finite(old[field]) !== null &&
          s[field] >= old[field]
            ? s[field] - old[field]
            : null;
        if (s.type === 'transport' && s.selectedCandidatePairId) {
          const pair = stats.get(s.selectedCandidatePairId);
          const candidate = pair && stats.get(pair.localCandidateId);
          if (pair && candidate) {
            const pc = connections(room).find(([name]) => name === role)?.[1]
              ._pc;
            transports.push({
              role,
              path: transportPath(candidate),
              state: pc?.connectionState,
              iceState: pc?.iceConnectionState,
              candidateType: candidate.candidateType,
              protocol: candidate.protocol,
              relayProtocol: candidate.relayProtocol,
              relayUrl: candidate.url?.split('?')[0],
              rttMs: ms(pair.currentRoundTripTime),
              bytesSent: pair.bytesSent,
              bytesReceived: pair.bytesReceived,
            });
          }
        }
        if (
          s.type === 'candidate-pair' &&
          s.state === 'failed' &&
          !this.failedPairs.has(key)
        ) {
          this.failedPairs.add(key);
          if (this.failedPairs.size > 200) this.failedPairs.clear();
          const candidate = stats.get(s.localCandidateId);
          this.event(
            'candidate_pair_failed',
            'An observed ICE candidate pair failed',
            { role, path: candidate ? transportPath(candidate) : 'Unknown' },
            'warning',
          );
        }
        if (
          !['inbound-rtp', 'outbound-rtp'].includes(s.type) ||
          (s.kind ?? s.mediaType) !== 'audio'
        )
          continue;
        const inbound = s.type === 'inbound-rtp';
        const bytes = delta(inbound ? 'bytesReceived' : 'bytesSent');
        const elapsed = old ? (s.timestamp - old.timestamp) / 1000 : 0;
        const remote = s.remoteId ? stats.get(s.remoteId) : undefined;
        const remoteOld = s.remoteId
          ? this.previous.get(`${role}:${s.remoteId}`)
          : undefined;
        const lost = inbound
          ? delta('packetsLost')
          : remote && remoteOld && remote.packetsLost >= remoteOld.packetsLost
            ? remote.packetsLost - remoteOld.packetsLost
            : null;
        const packets = delta(inbound ? 'packetsReceived' : 'packetsSent');
        const concealed = delta('concealedSamples'),
          received = delta('totalSamplesReceived');
        const buffer = delta('jitterBufferDelay'),
          emitted = delta('jitterBufferEmittedCount');
        let participant = inbound ? undefined : room.localParticipant.identity;
        let trackId = s.trackIdentifier || s.mid || s.id;
        if (inbound)
          for (const p of room.remoteParticipants.values())
            for (const pub of p.trackPublications.values()) {
              if (pub.track?.mediaStreamTrack.id === s.trackIdentifier) {
                participant = p.identity;
                trackId = pub.trackSid;
              }
            }
        const audio: AudioStats = {
          trackId,
          participant,
          codec: stats.get(s.codecId)?.mimeType,
          bytes: s[inbound ? 'bytesReceived' : 'bytesSent'],
          bitrateKbps:
            bytes !== null && elapsed > 0 ? (bytes * 8) / elapsed / 1000 : null,
          packetsLost: inbound ? s.packetsLost : remote?.packetsLost,
          lossPercent:
            lost !== null &&
            packets !== null &&
            (inbound ? packets + lost : packets) > 0
              ? Math.min(
                  100,
                  (lost / (inbound ? packets + lost : packets)) * 100,
                )
              : null,
          jitterMs: ms(inbound ? s.jitter : remote?.jitter),
          rttMs: ms(remote?.roundTripTime),
          concealedPercent:
            concealed !== null && received
              ? (concealed / received) * 100
              : null,
          jitterBufferMs:
            buffer !== null && emitted ? (buffer / emitted) * 1000 : null,
          audioLevel: finite(s.audioLevel),
        };
        (inbound ? incomingAudio : outgoingAudio).push(audio);
      }
    }
    this.previous = next;
    const mic = room.localParticipant.getTrackPublication(
      Track.Source.Microphone,
    )?.track?.mediaStreamTrack;
    const settings = mic?.getSettings();
    return {
      connectionState: room.state,
      connectionQuality: room.localParticipant.connectionQuality,
      transports,
      incomingAudio,
      outgoingAudio,
      localAudio: {
        muted: !room.localParticipant.isMicrophoneEnabled,
        trackState: mic?.readyState ?? 'not_acquired',
        trackEnabled: mic?.enabled,
        inputLevel: room.localParticipant.audioLevel,
        playbackAllowed: room.canPlaybackAudio,
        microphonePublished: !!mic,
      },
      deviceState: {
        microphone: mic?.label || null,
        sampleRate: settings?.sampleRate,
        channelCount: settings?.channelCount,
        echoCancellation: settings?.echoCancellation,
        noiseSuppression: settings?.noiseSuppression,
        autoGainControl: settings?.autoGainControl,
        visibility: document.visibilityState,
        online: navigator.onLine,
      },
    };
  }
  dispose() {
    for (const disposers of this.listeners.values())
      disposers.forEach((f) => f());
    this.listeners.clear();
    this.previous.clear();
  }
}
