import { useEffect, useRef, useState } from 'react';
import type { Participant, RemoteAudioTrack } from 'livekit-client';
import { ConnectionState } from 'livekit-client';
import { Mic, MicOff, PhoneOff } from 'lucide-react';
import { ApiError, api } from '@/api';
import type { User } from '@/api';
import { SettingsBar } from '@/components/SettingsBar';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n/I18nProvider';
import { cn } from '@/lib/utils';
import { useRoom } from './useRoom';

type Props = {
  user: User;
  roomName: string;
  onLeave: () => void;
};

export function RoomView({ user, roomName, onLeave }: Props) {
  const { state, connect, disconnect, toggleMute } = useRoom();
  const t = useT();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    api<{ token: string; url: string }>('/api/livekit-token', {
      method: 'POST',
      body: JSON.stringify({ roomName }),
    })
      .then(({ token, url }) => {
        if (!cancelled) return connect(url, token);
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof ApiError ? err.message : t('room.error.join'));
      });

    return () => {
      cancelled = true;
      disconnect();
    };
  }, [roomName, connect, disconnect]);

  function handleLeave() {
    disconnect();
    onLeave();
  }

  const isConnected = state.connectionState === ConnectionState.Connected;
  const isReconnecting = state.connectionState === ConnectionState.Reconnecting;
  const isConnecting =
    state.connectionState === ConnectionState.Connecting || isReconnecting;

  const count = state.participants.length;
  const cols = count <= 1 ? 1 : count <= 4 ? 2 : count <= 9 ? 3 : 4;
  const rows = Math.ceil(count / cols);

  return (
    <div className="flex h-svh flex-col bg-background">
      {state.audioTracks.map((track) => (
        <RemoteAudio key={track.sid} track={track} />
      ))}

      {/* Header */}
      <header className="flex h-11 shrink-0 items-center justify-between border-b px-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground"># {roomName}</span>
          <span
            className={cn(
              'h-1.5 w-1.5 rounded-full transition-colors',
              isConnected
                ? 'bg-emerald-500'
                : isConnecting
                  ? 'animate-pulse bg-amber-400'
                  : 'bg-muted-foreground',
            )}
          />
          {isReconnecting && (
            <span className="text-xs text-amber-500">{t('room.status.reconnecting')}</span>
          )}
          {!isReconnecting && isConnecting && (
            <span className="text-xs text-muted-foreground">{t('room.status.connecting')}</span>
          )}
          {error && <span className="text-xs text-destructive">{error}</span>}
        </div>
        <div className="flex items-center gap-2">
          <SettingsBar />
          <span className="flex h-6 items-center rounded-full bg-muted px-2.5 text-[11px] font-medium text-muted-foreground">
            {user.username}
          </span>
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Participant grid */}
        <main className="flex flex-1 overflow-hidden p-4">
          {count === 0 ? (
            <div className="flex flex-1 items-center justify-center">
              <p className="text-sm text-muted-foreground">
                {isConnecting
                  ? t('room.status.joining')
                  : error
                    ? t('room.status.cannotConnect')
                    : ''}
              </p>
            </div>
          ) : (
            <div
              className="grid w-full gap-3"
              style={{
                gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
              }}
            >
              {state.participants.map((p) => {
                const isLocal = p.identity === user.username;
                const isSpeaking = state.activeSpeakerIds.has(p.identity);
                const isMuted = isLocal ? state.isMuted : !p.isMicrophoneEnabled;
                return (
                  <ParticipantTile
                    key={p.identity}
                    participant={p}
                    isLocal={isLocal}
                    isSpeaking={isSpeaking}
                    isMuted={isMuted}
                    youLabel={t('room.you')}
                  />
                );
              })}
            </div>
          )}
        </main>

        {/* Sidebar */}
        <aside className="flex w-52 shrink-0 flex-col border-l">
          <div className="px-4 py-3">
            <p className="text-[10px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
              {t('room.sidebar.inRoom', { count })}
            </p>
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-3">
            {state.participants.map((p) => {
              const isLocal = p.identity === user.username;
              const isSpeaking = state.activeSpeakerIds.has(p.identity);
              const isMuted = isLocal ? state.isMuted : !p.isMicrophoneEnabled;
              return (
                <ParticipantRow
                  key={p.identity}
                  participant={p}
                  isLocal={isLocal}
                  isSpeaking={isSpeaking}
                  isMuted={isMuted}
                  youLabel={t('room.you')}
                />
              );
            })}
          </div>
        </aside>
      </div>

      {/* Controls */}
      <footer className="flex h-16 shrink-0 items-center justify-center gap-2.5 border-t bg-muted/20 px-6">
        <Button
          variant={state.isMuted ? 'secondary' : 'outline'}
          size="icon"
          onClick={toggleMute}
          className="h-9 w-9 rounded-full"
          title={state.isMuted ? t('room.action.unmute') : t('room.action.mute')}
        >
          {state.isMuted ? (
            <MicOff className="h-3.5 w-3.5" />
          ) : (
            <Mic className="h-3.5 w-3.5" />
          )}
        </Button>
        <Button
          variant="destructive"
          size="icon"
          onClick={handleLeave}
          className="h-9 w-9 rounded-full"
          title={t('room.action.leave')}
        >
          <PhoneOff className="h-3.5 w-3.5" />
        </Button>
      </footer>
    </div>
  );
}

function ParticipantTile({
  participant,
  isLocal,
  isSpeaking,
  isMuted,
  youLabel,
}: {
  participant: Participant;
  isLocal: boolean;
  isSpeaking: boolean;
  isMuted: boolean;
  youLabel: string;
}) {
  const initial = (participant.identity[0] ?? '?').toUpperCase();

  return (
    <div
      className={cn(
        'relative flex flex-col items-center justify-center rounded-xl border bg-card transition-all duration-150',
        isSpeaking
          ? 'border-primary/40 ring-2 ring-primary ring-offset-2 ring-offset-background'
          : 'border-border',
      )}
    >
      <div
        className={cn(
          'flex h-14 w-14 items-center justify-center rounded-full bg-primary font-heading text-2xl font-normal italic text-primary-foreground transition-transform duration-150',
          isSpeaking && 'scale-110',
        )}
      >
        {initial}
      </div>

      <p className="mt-3 text-sm font-medium text-foreground">
        {participant.identity}
        {isLocal && (
          <span className="ml-1 text-xs font-normal text-muted-foreground">
            {youLabel}
          </span>
        )}
      </p>

      {isMuted && (
        <div className="absolute bottom-2.5 right-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-muted">
          <MicOff className="h-2.5 w-2.5 text-muted-foreground" />
        </div>
      )}
    </div>
  );
}

function ParticipantRow({
  participant,
  isLocal,
  isSpeaking,
  isMuted,
  youLabel,
}: {
  participant: Participant;
  isLocal: boolean;
  isSpeaking: boolean;
  isMuted: boolean;
  youLabel: string;
}) {
  const initial = (participant.identity[0] ?? '?').toUpperCase();

  return (
    <div className="flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/50">
      <div
        className={cn(
          'relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-medium transition-all duration-150',
          isSpeaking
            ? 'bg-primary text-primary-foreground'
            : 'bg-primary/10 text-primary',
        )}
      >
        {initial}
        {isSpeaking && (
          <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-background" />
        )}
      </div>
      <span className="flex-1 truncate text-xs font-medium text-foreground">
        {participant.identity}
        {isLocal && (
          <span className="ml-1 font-normal text-muted-foreground">{youLabel}</span>
        )}
      </span>
      {isMuted && <MicOff className="h-3 w-3 shrink-0 text-muted-foreground" />}
    </div>
  );
}

function RemoteAudio({ track }: { track: RemoteAudioTrack }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);
  return <audio ref={audioRef} autoPlay className="hidden" />;
}
