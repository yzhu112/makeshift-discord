import type { FormEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { Participant, RemoteAudioTrack } from 'livekit-client';
import { ConnectionState } from 'livekit-client';
import {
  MessageSquare,
  Mic,
  MicOff,
  PhoneOff,
  Send,
  Users,
  X,
} from 'lucide-react';
import { ApiError, api } from '@/api';
import type { User } from '@/api';
import { CopyCode } from '@/components/CopyCode';
import { SettingsBar } from '@/components/SettingsBar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useT } from '@/i18n/I18nProvider';
import { cn } from '@/lib/utils';
import type { ChatMessage } from './useRoom';
import { useRoom } from './useRoom';

type Props = {
  user: User;
  roomName: string;
  onLeave: () => void;
};

export function RoomView({ user, roomName, onLeave }: Props) {
  const { state, connect, disconnect, toggleMute, sendMessage } = useRoom();
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'people' | 'chat'>('people');
  const [chatOpen, setChatOpen] = useState(false);
  const [seenCount, setSeenCount] = useState(0);
  const room = user.rooms.find((r) => r.name === roomName);
  const unread = state.messages.length - seenCount;

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

  // Mark messages as read while the chat is on screen (desktop tab or mobile sheet).
  useEffect(() => {
    if (tab === 'chat' || chatOpen) setSeenCount(state.messages.length);
  }, [tab, chatOpen, state.messages.length]);

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
      <header className="flex min-h-12 shrink-0 items-center justify-between border-b px-3 pt-[env(safe-area-inset-top)] sm:min-h-11 sm:px-4 sm:pt-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground"># {roomName}</span>
          <span
            className={cn(
              'h-1.5 w-1.5 shrink-0 rounded-full transition-colors',
              isConnected
                ? 'bg-emerald-500'
                : isConnecting
                  ? 'animate-pulse bg-amber-400'
                  : 'bg-muted-foreground',
            )}
          />
          {isReconnecting && (
            <span className="hidden text-xs text-amber-500 sm:inline">{t('room.status.reconnecting')}</span>
          )}
          {!isReconnecting && isConnecting && (
            <span className="hidden text-xs text-muted-foreground sm:inline">{t('room.status.connecting')}</span>
          )}
          {error && <span className="hidden text-xs text-destructive sm:inline">{error}</span>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          {room?.code && <CopyCode code={room.code} />}
          <button
            type="button"
            onClick={() => setChatOpen(true)}
            aria-label={t('room.chat.open')}
            className="relative inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
          >
            <MessageSquare className="h-4 w-4" />
            {unread > 0 && (
              <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-primary ring-2 ring-background" />
            )}
          </button>
          <SettingsBar />
          <span className="hidden h-6 items-center rounded-full bg-muted px-2.5 text-[11px] font-medium text-muted-foreground sm:flex">
            {user.username}
          </span>
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Participant grid */}
        <main className="flex flex-1 overflow-hidden p-3 sm:p-4">
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

        {/* Sidebar — tabbed: participants / chat */}
        <aside className="hidden w-72 shrink-0 flex-col border-l md:flex">
          <div className="flex shrink-0 border-b">
            <SidebarTab
              active={tab === 'people'}
              onClick={() => setTab('people')}
              icon={<Users className="h-3.5 w-3.5" />}
              label={t('room.tab.people')}
              badge={count}
            />
            <SidebarTab
              active={tab === 'chat'}
              onClick={() => setTab('chat')}
              icon={<MessageSquare className="h-3.5 w-3.5" />}
              label={t('room.tab.chat')}
              dot={unread > 0}
            />
          </div>
          {tab === 'people' ? (
            <div className="flex-1 overflow-y-auto px-2 py-2">
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
          ) : (
            <ChatSection
              messages={state.messages}
              currentUser={user.username}
              onSend={sendMessage}
            />
          )}
        </aside>
      </div>

      {/* Controls */}
      <footer className="flex shrink-0 items-center justify-center gap-4 border-t bg-muted/20 px-6 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] sm:h-16 sm:gap-2.5 sm:py-0">
        <Button
          variant={state.isMuted ? 'secondary' : 'outline'}
          size="icon"
          onClick={toggleMute}
          className="h-14 w-14 rounded-full sm:h-9 sm:w-9"
          title={state.isMuted ? t('room.action.unmute') : t('room.action.mute')}
        >
          {state.isMuted ? (
            <MicOff className="h-5 w-5 sm:h-3.5 sm:w-3.5" />
          ) : (
            <Mic className="h-5 w-5 sm:h-3.5 sm:w-3.5" />
          )}
        </Button>
        <Button
          variant="destructive"
          size="icon"
          onClick={handleLeave}
          className="h-14 w-14 rounded-full sm:h-9 sm:w-9"
          title={t('room.action.leave')}
        >
          <PhoneOff className="h-5 w-5 sm:h-3.5 sm:w-3.5" />
        </Button>
      </footer>

      {/* Mobile chat sheet */}
      {chatOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background md:hidden">
          <div className="flex min-h-12 shrink-0 items-center justify-between border-b px-3 pt-[env(safe-area-inset-top)]">
            <span className="text-sm font-medium text-foreground">
              {t('room.tab.chat')}
            </span>
            <button
              type="button"
              onClick={() => setChatOpen(false)}
              aria-label={t('room.chat.close')}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <ChatSection
            messages={state.messages}
            currentUser={user.username}
            onSend={sendMessage}
          />
        </div>
      )}
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

function SidebarTab({
  active,
  onClick,
  icon,
  label,
  badge,
  dot,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  badge?: number;
  dot?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'relative flex flex-1 items-center justify-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-medium transition-colors',
        active
          ? 'border-primary text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      {icon}
      {label}
      {badge != null && badge > 0 && (
        <span className="rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground">
          {badge}
        </span>
      )}
      {dot && (
        <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-primary" />
      )}
    </button>
  );
}

function ChatSection({
  messages,
  currentUser,
  onSend,
}: {
  messages: ChatMessage[];
  currentUser: string;
  onSend: (text: string) => Promise<void>;
}) {
  const t = useT();
  const [text, setText] = useState('');
  const [failed, setFailed] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const value = text.trim();
    if (!value) return;
    setText('');
    setFailed(false);
    try {
      await onSend(value);
    } catch {
      // Send rejected (not connected / too large) — restore the draft.
      setFailed(true);
      setText(value);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {messages.length === 0 ? (
          <p className="px-1 py-2 text-xs text-muted-foreground">
            {t('room.chat.empty')}
          </p>
        ) : (
          <div className="space-y-2.5">
            {messages.map((m) => {
              const mine = m.sender === currentUser;
              return (
                <div
                  key={m.id}
                  className={cn(
                    'flex flex-col',
                    mine ? 'items-end' : 'items-start',
                  )}
                >
                  {!mine && (
                    <span className="px-1 text-[11px] font-medium text-muted-foreground">
                      {m.sender}
                    </span>
                  )}
                  <div
                    className={cn(
                      'max-w-[85%] rounded-2xl px-3 py-1.5 text-sm whitespace-pre-wrap break-words',
                      mine
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-foreground',
                    )}
                  >
                    {m.text}
                  </div>
                </div>
              );
            })}
            <div ref={endRef} />
          </div>
        )}
      </div>
      <form
        onSubmit={submit}
        className="flex shrink-0 items-center gap-2 border-t p-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] sm:pb-3"
      >
        <Input
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setFailed(false);
          }}
          placeholder={t('room.chat.placeholder')}
          aria-label={t('room.chat.placeholder')}
          aria-invalid={failed}
          className="max-sm:h-12"
        />
        <Button
          type="submit"
          size="icon"
          disabled={!text.trim()}
          aria-label={t('room.chat.send')}
          className="shrink-0 max-sm:h-12 max-sm:w-12"
        >
          <Send className="h-4 w-4" />
        </Button>
      </form>
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
