import { ApiError, api, type User } from '@/api';
import { participantVolumeKey, savedParticipantVolume } from '@/audio/participantVolume';
import { CallTelemetry, errorDetails } from '@/diagnostics/telemetry';
import { useT } from '@/i18n/I18nProvider';
import { ConnectionState, type RemoteAudioTrack } from 'livekit-client';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useRoom } from './useRoom';

function useCallSession(user: User, roomName: string | null, teardown: RefObject<Promise<void>>) {
  const controls = useRoom();
  const { connect, disconnect, state } = controls;
  const t = useT();
  const translate = useRef(t);
  translate.current = t;
  const [error, setError] = useState<string | null>(null);
  const [volumes, setVolumes] = useState<Map<string, number>>(() => new Map());
  const [seenCount, setSeenCount] = useState(0);
  const [chatDraft, setChatDraft] = useState('');
  const getVolume = (identity: string) => volumes.get(participantVolumeKey(user.id, identity)) ?? savedParticipantVolume(user.id, identity);
  function changeVolume(identity: string, volume: number) {
    const key = participantVolumeKey(user.id, identity);
    setVolumes(previous => new Map(previous).set(key, volume));
    try { localStorage.setItem(key, String(volume)); } catch { /* Optional preference. */ }
  }
  useEffect(() => {
    if (!roomName) return;
    let cancelled = false;
    const abort = new AbortController();
    let telemetry: CallTelemetry | undefined;
    let joined = false;
    // Defer the start so StrictMode's setup/cleanup probe doesn't create a fake attempt.
    const task = setTimeout(async () => {
      await teardown.current;
      if (cancelled) return;
      try { telemetry = new CallTelemetry(user.id, roomName); } catch { /* Telemetry is optional. */ }
      try {
        const { token, url } = await api<{ token: string; url: string }>('/api/livekit-token', {
          method: 'POST', signal: abort.signal,
          body: JSON.stringify({ roomName, diagnosticSessionId: telemetry?.id }),
        });
        telemetry?.event('token_received', 'Join token received');
        if (!cancelled) await connect(url, token, room => {
          try { telemetry?.attach(room); } catch { /* Diagnostics must not block joining. */ }
          room.once('connected', () => { joined = true; });
        });
      } catch (err) {
        if (!cancelled) {
          telemetry?.event(joined ? 'audio_setup_failed' : 'join_failed', joined ? 'Joined, but audio setup failed' : 'Unable to join room', errorDetails(err), 'error');
          setError(err instanceof ApiError ? err.message : translate.current('room.error.join'));
        }
      }
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(task);
      abort.abort();
      telemetry?.finish();
      // Preserve an earlier room's pending teardown during StrictMode probes or rapid switches.
      teardown.current = Promise.all([teardown.current, disconnect()]).then(() => {}).catch(() => {});
    };
  }, [roomName, user.id, connect, disconnect, teardown]);

  const isConnected = state.connectionState === ConnectionState.Connected;
  const audioSettings = roomName ? {
    mode: controls.noiseMode,
    busy: controls.microphoneBusy || controls.noiseBusy || !isConnected,
    onChange: controls.changeNoiseMode,
    beginTest: controls.beginMicrophoneTest,
  } : undefined;
  return { ...controls, roomName, error, setError, getVolume, changeVolume,
    seenCount, setSeenCount, chatDraft, setChatDraft, audioSettings };
}

const ActiveCallContext = createContext<ReturnType<typeof useCallSession> | null>(null);
export const useActiveCall = () => useContext(ActiveCallContext);

export function ActiveCallProvider({ user, roomName, teardown, children }: {
  user: User;
  roomName: string | null;
  teardown: RefObject<Promise<void>>;
  children: ReactNode;
}) {
  const call = useCallSession(user, roomName, teardown);
  return <ActiveCallContext.Provider value={call}>
    {call.state.audioTracks.map(track => {
      const owner = call.state.participants.find(participant =>
        [...participant.audioTrackPublications.values()].some(publication => publication.track === track));
      return <RemoteAudio key={track.sid} track={track} volume={owner ? call.getVolume(owner.identity) : 100} />;
    })}
    {children}
  </ActiveCallContext.Provider>;
}

function RemoteAudio({ track, volume }: { track: RemoteAudioTrack; volume: number }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);
  useEffect(() => {
    // Apply after attachment, including zero, and whenever a replacement track arrives.
    track.setVolume(volume / 100);
  }, [track, volume]);
  return <audio ref={audioRef} autoPlay className="hidden" />;
}
