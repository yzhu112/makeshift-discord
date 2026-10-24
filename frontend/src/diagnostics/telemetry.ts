import {
  DisconnectReason,
  LogLevel,
  Room,
  RoomEvent,
  setLogExtension,
  version,
} from 'livekit-client';
import { api, ApiError } from '@/api';
import { StatsCollector } from './stats';
import type { Details, Metrics } from './types';

type EventRecord = {
  seq: number;
  at: number;
  type: string;
  level: 'info' | 'warning' | 'error';
  message: string;
  details: Details;
};
type Pending = {
  registered?: boolean;
  id: string;
  roomName: string;
  userId: number;
  attemptedAt: number;
  clientInfo: Details;
  events: EventRecord[];
  samples: { seq: number; at: number; data: Metrics }[];
};
const prefix = 'voice-diagnostics-v1:';
const active = new Set<CallTelemetry>();
let loggingInstalled = false;
function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[truncated]';
  if (typeof value === 'string')
    return value
      .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g, '[token]')
      .replace(
        /(https?|wss?):\/\/[^\s"<>]+/g,
        (url) => url.split('?')[0].split('#')[0],
      )
      .slice(0, 1200);
  if (value instanceof Error)
    return { name: value.name, message: sanitize(value.message) };
  if (Array.isArray(value))
    return value.slice(0, 20).map((v) => sanitize(v, depth + 1));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key]) =>
            !/token|credential|password|secret|authorization|cookie|sdp|address|deviceid|groupid|invite/i.test(
              key,
            ),
        )
        .slice(0, 30)
        .map(([k, v]) => [k, sanitize(v, depth + 1)]),
    );
  return value ?? null;
}
export function errorDetails(error: unknown): Details {
  if (!(error instanceof Error)) return { message: String(error) };
  const e = error as Error & {
    code?: unknown;
    status?: unknown;
    reason?: unknown;
  };
  return {
    name: e.name,
    message: sanitize(e.message),
    code: e.code,
    status: e.status,
    reason: e.reason,
  };
}
function key(p: Pending) {
  return `${prefix}${p.userId}:${p.id}`;
}
function save(p: Pending) {
  try {
    // Bounded local retry buffer: samples yield to errors when offline.
    while (JSON.stringify(p).length > 100_000 && p.samples.length)
      p.samples.shift();
    while (JSON.stringify(p).length > 100_000 && p.events.length > 1)
      p.events.shift();
    localStorage.setItem(key(p), JSON.stringify(p));
    const keys = Object.keys(localStorage).filter((k) => k.startsWith(prefix));
    let total = keys.reduce(
      (n, k) => n + (localStorage.getItem(k)?.length ?? 0),
      0,
    );
    for (const k of keys.sort()) {
      if (total < 300_000) break;
      if (k === key(p)) continue;
      total -= localStorage.getItem(k)?.length ?? 0;
      localStorage.removeItem(k);
    }
  } catch {
    /* Storage can be unavailable in private browsing. */
  }
}
async function upload(p: Pending) {
  if (!p.registered) {
    await api('/api/diagnostics/sessions', {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({
        id: p.id,
        roomName: p.roomName,
        attemptedAt: p.attemptedAt,
        clientInfo: p.clientInfo,
      }),
    });
    p.registered = true;
  }
  // Respect request/record limits, including when replaying an offline queue.
  const events = p.events.slice(0, 40),
    samples = p.samples.slice(0, 4);
  while (
    new TextEncoder().encode(
      JSON.stringify({ events, samples, clientInfo: p.clientInfo }),
    ).length > 60000
  ) {
    if (samples.length) samples.pop();
    else if (events.length > 1) events.pop();
    else break;
  }
  try {
    await api(`/api/diagnostics/sessions/${p.id}/batch`, {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({ events, samples, clientInfo: p.clientInfo }),
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      p.registered = false;
      save(p);
    }
    throw error;
  }
  const acknowledgedEvents = new Set(events.map((event) => event.seq));
  const acknowledgedSamples = new Set(samples.map((sample) => sample.seq));
  p.events = p.events.filter((event) => !acknowledgedEvents.has(event.seq));
  p.samples = p.samples.filter(
    (sample) => !acknowledgedSamples.has(sample.seq),
  );
  if (p.events.length || p.samples.length) save(p);
  else
    try {
      localStorage.removeItem(key(p));
    } catch {}
}
export function resumePendingDiagnostics(userId: number) {
  let stopped = false,
    busy = false;
  const drain = async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      for (const k of Object.keys(localStorage).filter((k) =>
        k.startsWith(`${prefix}${userId}:`),
      )) {
        const p = JSON.parse(
          localStorage.getItem(k) || 'null',
        ) as Pending | null;
        if (!p || activeHas(p.id)) continue;
        try {
          await upload(p);
        } catch {
          break;
        }
      }
    } catch {
      /* Corrupt/unavailable storage must not affect calls. */
    } finally {
      busy = false;
    }
  };
  void drain();
  const timer = setInterval(drain, 10000);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
const activeHas = (id: string) => [...active].some((t) => t.id === id);
export class CallTelemetry {
  readonly id = crypto.randomUUID();
  private pending: Pending;
  private seq = 0;
  private closed = false;
  private flushing = false;
  private sampling = false;
  private timer: ReturnType<typeof setInterval>;
  private sampleTimer?: ReturnType<typeof setInterval>;
  private scanTimer?: ReturnType<typeof setInterval>;
  private stats: StatsCollector;
  private dispose: (() => void)[] = [];
  private lastTransport = '';
  constructor(userId: number, roomName: string) {
    this.pending = {
      id: this.id,
      userId,
      roomName,
      attemptedAt: Date.now(),
      events: [],
      samples: [],
      clientInfo: {
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        language: navigator.language,
        sdkVersion: version,
        appVersion: import.meta.env.VITE_APP_VERSION || 'development',
      },
    };
    this.stats = new StatsCollector((...args) => this.event(...args));
    this.timer = setInterval(() => void this.flush(), 15000);
    active.add(this);
    if (!loggingInstalled) {
      loggingInstalled = true;
      setLogExtension((level, message, context) => {
        if (level < LogLevel.warn) return;
        for (const telemetry of active)
          telemetry.event(
            'sdk_log',
            message,
            (sanitize(context) || {}) as Details,
            level >= LogLevel.error ? 'error' : 'warning',
          );
      });
    }
    const online = () => {
      this.event('browser_online', 'Browser reports online');
      void this.flush();
    };
    const offline = () =>
      this.event('browser_offline', 'Browser reports offline', {}, 'warning');
    const visibility = () => {
      this.event('visibility_changed', `Page ${document.visibilityState}`);
      if (document.hidden) this.beacon();
    };
    const pagehide = () => {
      this.finish('page_closed');
      this.beacon();
    };
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    window.addEventListener('pagehide', pagehide);
    document.addEventListener('visibilitychange', visibility);
    this.dispose.push(() => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
      window.removeEventListener('pagehide', pagehide);
      document.removeEventListener('visibilitychange', visibility);
    });
    this.event('join_requested', 'Join requested');
    void this.flush();
  }
  event(
    type: string,
    message: string,
    details: Details = {},
    level: 'info' | 'warning' | 'error' = 'info',
  ) {
    if (this.closed) return;
    // Suppress runaway repeated SDK logs, while retaining structured lifecycle events.
    if (
      type === 'sdk_log' &&
      this.pending.events.filter((e) => e.type === 'sdk_log').length >= 20
    )
      return;
    const cleaned = sanitize(details) as Details;
    const bounded =
      JSON.stringify(cleaned).length <= 12000
        ? cleaned
        : { summary: JSON.stringify(cleaned).slice(0, 3000), truncated: true };
    this.pending.events.push({
      seq: this.seq++,
      at: Date.now(),
      type,
      level,
      message: String(sanitize(message)),
      details: bounded,
    });
    save(this.pending);
    if (level === 'error') void this.flush();
  }
  attach(room: Room) {
    if (this.closed) return;
    const on = (name: RoomEvent, fn: (...args: any[]) => void) => {
      room.on(name, fn);
      this.dispose.push(() => room.off(name, fn));
    };
    on(RoomEvent.SignalConnected, () =>
      this.event('signal_connected', 'LiveKit signaling connected'),
    );
    const connected = () => {
      void room
        .getSid()
        .then((roomSid) =>
          this.event('connected', 'Media connection established', {
            roomSid,
            participantSid: room.localParticipant.sid,
          }),
        )
        .catch(() => {});
    };
    on(RoomEvent.Connected, connected);
    on(RoomEvent.Reconnected, connected);
    on(RoomEvent.Reconnecting, () =>
      this.event(
        'reconnecting',
        'Media connection is reconnecting',
        {},
        'warning',
      ),
    );
    on(RoomEvent.SignalReconnecting, () =>
      this.event(
        'signal_reconnecting',
        'Signaling connection is reconnecting',
        {},
        'warning',
      ),
    );
    on(RoomEvent.ConnectionStateChanged, (state) =>
      this.event('connection_state', `Connection ${state}`, { state }),
    );
    on(RoomEvent.Disconnected, (reason) =>
      this.event(
        'disconnected',
        'LiveKit disconnected',
        {
          reason:
            reason === undefined
              ? 'UNKNOWN_REASON'
              : (DisconnectReason[reason] ?? String(reason)),
        },
        reason === DisconnectReason.CLIENT_INITIATED ? 'info' : 'warning',
      ),
    );
    on(RoomEvent.ConnectionQualityChanged, (quality, participant) => {
      if (participant.isLocal)
        this.event('connection_quality', `Connection quality: ${quality}`, {
          quality,
        });
    });
    on(RoomEvent.TrackSubscribed, (track, pub, participant) =>
      this.event('track_subscribed', 'Remote audio/media track ready', {
        trackId: pub.trackSid,
        kind: track.kind,
        participant: participant.identity,
      }),
    );
    on(RoomEvent.TrackUnsubscribed, (_track, pub, participant) =>
      this.event('track_unsubscribed', 'Remote track removed', {
        trackId: pub.trackSid,
        participant: participant.identity,
      }),
    );
    on(RoomEvent.TrackSubscriptionFailed, (trackId, participant, error) =>
      this.event(
        'subscription_failed',
        'Unable to subscribe to remote track',
        { trackId, participant: participant?.identity, ...errorDetails(error) },
        'error',
      ),
    );
    on(RoomEvent.LocalTrackPublished, (pub) =>
      this.event('track_published', 'Local track published', {
        trackId: pub.trackSid,
        kind: pub.kind,
      }),
    );
    on(RoomEvent.LocalTrackUnpublished, (pub) =>
      this.event('track_unpublished', 'Local track unpublished', {
        trackId: pub.trackSid,
      }),
    );
    on(RoomEvent.TrackMuted, (pub, participant) =>
      this.event('track_muted', 'Track muted', {
        trackId: pub.trackSid,
        participant: participant.identity,
      }),
    );
    on(RoomEvent.TrackUnmuted, (pub, participant) =>
      this.event('track_unmuted', 'Track unmuted', {
        trackId: pub.trackSid,
        participant: participant.identity,
      }),
    );
    on(RoomEvent.MediaDevicesError, (error) =>
      this.event(
        'microphone_error',
        'Media device error',
        errorDetails(error),
        'error',
      ),
    );
    on(RoomEvent.MediaDevicesChanged, () =>
      this.event('devices_changed', 'Available media devices changed'),
    );
    on(RoomEvent.LocalAudioSilenceDetected, () =>
      this.event(
        'microphone_silent',
        'Microphone capture appears silent',
        {},
        'warning',
      ),
    );
    on(RoomEvent.AudioPlaybackStatusChanged, () =>
      this.event(
        'playback_status',
        room.canPlaybackAudio
          ? 'Audio playback allowed'
          : 'Browser blocked audio playback',
        { allowed: room.canPlaybackAudio },
        room.canPlaybackAudio ? 'info' : 'warning',
      ),
    );
    on(RoomEvent.ActiveDeviceChanged, (kind, device) =>
      this.event('active_device_changed', 'Active media device changed', {
        kind,
        selected: !!device,
      }),
    );
    const sample = async () => {
      if (this.closed || this.sampling) return;
      this.sampling = true;
      try {
        const data = await this.stats.sample(room);
        if (this.closed) return;
        while (
          JSON.stringify(data).length > 12000 &&
          (data.incomingAudio.length || data.outgoingAudio.length)
        ) {
          if (data.incomingAudio.length) data.incomingAudio.pop();
          else data.outgoingAudio.pop();
        }
        this.pending.samples.push({ seq: this.seq++, at: Date.now(), data });
        const transport = JSON.stringify(
          data.transports.map((t) => ({
            role: t.role,
            path: t.path,
            relayUrl: t.relayUrl,
          })),
        );
        if (data.transports.length && transport !== this.lastTransport) {
          this.lastTransport = transport;
          this.event(
            'transport_changed',
            data.transports.map((t) => `${t.role}: ${t.path}`).join(' · '),
            { transports: data.transports },
          );
        }
        save(this.pending);
      } catch {
        /* Missing/closed stats must never interrupt media. */
      } finally {
        this.sampling = false;
      }
    };
    void sample();
    this.sampleTimer = setInterval(sample, 10000);
    // Discover transports during connection setup without patching browser globals.
    let scans = 0;
    this.scanTimer = setInterval(() => {
      this.stats.bind(room);
      if (++scans >= 40) clearInterval(this.scanTimer);
    }, 250);
  }
  async flush() {
    if (this.flushing) return;
    this.flushing = true;
    try {
      await upload(this.pending);
    } catch {
      /* Retry from memory/localStorage on the next tick. */
    } finally {
      this.flushing = false;
      if (
        this.closed &&
        !this.pending.events.length &&
        !this.pending.samples.length
      ) {
        clearInterval(this.timer);
        active.delete(this);
      }
    }
  }
  private beacon() {
    try {
      navigator.sendBeacon(
        `/api/diagnostics/sessions/${this.id}/batch`,
        new Blob(
          [
            JSON.stringify({
              events: this.pending.events.slice(0, 30),
              samples: this.pending.samples.slice(0, 2),
            }),
          ],
          { type: 'application/json' },
        ),
      );
    } catch {}
  }
  finish(reason = 'client_left') {
    if (this.closed) return;
    this.event(
      'disconnected',
      reason === 'client_left' ? 'Left call' : reason,
      { reason },
    );
    this.closed = true;
    clearInterval(this.sampleTimer);
    clearInterval(this.scanTimer);
    this.stats.dispose();
    this.dispose.forEach((fn) => fn());
    this.dispose = [];
    void this.flush();
  }
}
