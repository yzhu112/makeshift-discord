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
  Volume2,
} from 'lucide-react';
import { ApiError, api } from '@/api';
import type { User } from '@/api';
import { CopyCode } from '@/components/CopyCode';
import { AppHeader } from '@/components/AppHeader';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useT } from '@/i18n/I18nProvider';
import { cn } from '@/lib/utils';
import type { ChatMessage } from './useRoom';
import { useRoom } from './useRoom';
import { ParticipantVolume } from './ParticipantVolume';
import { participantVolumeKey, savedParticipantVolume } from '@/audio/participantVolume';
import { CallTelemetry, errorDetails } from '@/diagnostics/telemetry';

type Props = {
  user: User;
  roomName: string;
  onLeave: () => void;
};

export function RoomView({ user, roomName, onLeave }: Props) {
  const { microphoneBusy, startAudio, beginMicrophoneTest, isTestingMicrophone, state, connect, disconnect, toggleMute, sendMessage, noiseMode, noiseBusy, noiseNotice, changeNoiseMode } = useRoom();
  const t = useT();
  const [volumes, setVolumes] = useState<Map<string, number>>(() => new Map());
  const getVolume = (identity: string) => volumes.get(participantVolumeKey(user.id, identity)) ?? savedParticipantVolume(user.id, identity);
  function changeVolume(identity: string, volume: number) {
    const key = participantVolumeKey(user.id, identity);
    setVolumes(previous => new Map(previous).set(key, volume));
    try { localStorage.setItem(key, String(volume)); } catch { /* Optional preference. */ }
  }
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'people' | 'chat'>('people');
  const [chatOpen, setChatOpen] = useState(false);
  const [seenCount, setSeenCount] = useState(0);
  const room = user.rooms.find((r) => r.name === roomName);
  const unread = state.messages.length - seenCount;

  useEffect(() => {
    let cancelled = false;
    const abort = new AbortController();
    let telemetry: CallTelemetry | undefined;
    let joined = false;
    // Defer the start so StrictMode's setup/cleanup probe doesn't create a fake attempt.
    const task = setTimeout(async () => {
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
          setError(err instanceof ApiError ? err.message : t('room.error.join'));
        }
      }
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(task);
      abort.abort();
      telemetry?.finish();
      disconnect();
    };
  }, [roomName, user.id, connect, disconnect]);

  useEffect(() => {
    if (tab === 'chat' || chatOpen) setSeenCount(state.messages.length);
  }, [tab, chatOpen, state.messages.length]);

  function handleLeave() {
    disconnect();
    onLeave();
  }

  const isConnected = state.connectionState === ConnectionState.Connected;
  const isReconnecting = state.connectionState === ConnectionState.Reconnecting;
  const isConnecting = state.connectionState === ConnectionState.Connecting || isReconnecting;
  const count = state.participants.length;
  const connectionLabel = error ? t('room.status.cannotConnect') : isReconnecting ? t('room.status.reconnecting') : isConnected ? t('ui.connected') : isConnecting ? t('room.status.connecting') : t('ui.disconnected');

  return (
    <div className="workspace call-page">
      {state.audioTracks.map(track => {
        const owner = state.participants.find(participant =>
          [...participant.audioTrackPublications.values()].some(publication => publication.track === track));
        return <RemoteAudio key={track.sid} track={track} volume={owner ? getVolume(owner.identity) : 100} />;
      })}
      <AppHeader section={roomName} username={user.username} audio={{ mode: noiseMode, busy: microphoneBusy || noiseBusy || !isConnected, onChange: changeNoiseMode, beginTest: beginMicrophoneTest }} />
      <div className="call-layout">
        <main className="call-main">
          <div className="call-heading">
            <div>
              <p className="app-eyebrow">{t('ui.voiceChannel')}</p>
              <h1>{roomName}</h1>
              <div className="call-meta">
                <span className={`call-connection ${isConnected && !error ? 'connected' : ''}`} role="status"><i />{connectionLabel}</span>
                <span>{t('room.sidebar.inRoom', { count })}</span>
              </div>
            </div>
            {room?.code && <div className="call-share"><CopyCode code={room.code} /></div>}
          </div>
          {error && <p role="alert" className="call-notice call-error">{error}</p>}
          {state.microphoneIssue && <p role="status" className="call-notice">{t(
            state.microphoneIssue === 'blocked' ? 'room.microphone.blocked' :
            state.microphoneIssue === 'unavailable' ? 'room.microphone.unavailable' : 'room.microphone.error'
          )}</p>}
          {!state.canPlaybackAudio && isConnected && (
            <Button variant="outline" className="app-button" onClick={() => void startAudio().catch(() => setError(t('room.volume.playbackError')))}>
              <Volume2 size={16} />{t('room.volume.enableAudio')}
            </Button>
          )}
          <div className="call-stage">
            {count === 0 ? (
              <div className="app-empty call-empty"><Volume2 size={28} strokeWidth={1.4} /><p>{isConnecting ? t('room.status.joining') : t('room.status.cannotConnect')}</p></div>
            ) : (
              <div className="participant-grid">
                {state.participants.map(p => (
                  <ParticipantTile key={p.identity} participant={p} isLocal={p.identity === user.username}
                    isSpeaking={state.activeSpeakerIds.has(p.identity)}
                    isMuted={p.identity === user.username ? state.isMuted : !p.isMicrophoneEnabled}
                    youLabel={t('room.you')} volume={getVolume(p.identity)} onVolumeChange={volume => changeVolume(p.identity, volume)} />
                ))}
              </div>
            )}
          </div>
          {noiseNotice && <p role="status" className="call-notice">{t(noiseNotice === 'fallback' ? 'room.noise.fallback' : noiseNotice === 'restore' ? 'audio.restoreError' : 'room.noise.error')}</p>}
        </main>
        <aside className="call-sidebar" aria-label={t('room.tab.people')}>
          <div className="call-tabs">
            <SidebarTab active={tab === 'people'} onClick={() => setTab('people')} icon={<Users size={14} />} label={t('room.tab.people')} badge={count} />
            <SidebarTab active={tab === 'chat'} onClick={() => setTab('chat')} icon={<MessageSquare size={14} />} label={t('room.tab.chat')} dot={unread > 0} />
          </div>
          {tab === 'people' ? (
            <div className="participant-list">
              <p className="app-eyebrow">{t('room.sidebar.inRoom', { count })}</p>
              {state.participants.map(p => (
                <ParticipantRow key={p.identity} participant={p} isLocal={p.identity === user.username}
                  isSpeaking={state.activeSpeakerIds.has(p.identity)}
                  isMuted={p.identity === user.username ? state.isMuted : !p.isMicrophoneEnabled} youLabel={t('room.you')} />
              ))}
            </div>
          ) : <ChatSection messages={state.messages} currentUser={user.username} onSend={sendMessage} />}
        </aside>
      </div>
      <footer className="call-controls">
        <div className="call-self"><span className="self-avatar">{user.username.slice(0, 1).toUpperCase()}</span><div><strong>{user.username}</strong><small>{t(isTestingMicrophone ? 'audio.micTest' : state.isMuted ? 'ui.micMuted' : 'ui.micOn')}</small></div></div>
        <div className="call-control-buttons">
          <Button disabled={!isConnected || noiseBusy || microphoneBusy || isTestingMicrophone} variant="outline" onClick={() => void toggleMute()} className="app-button call-mute" aria-pressed={state.isMuted}>
            {state.isMuted ? <MicOff size={16} /> : <Mic size={16} />}<span>{t(microphoneBusy ? 'room.microphone.starting' : state.microphoneIssue && state.isMuted ? 'room.microphone.enable' : state.isMuted ? 'room.action.unmute' : 'room.action.mute')}</span>
          </Button>
          <Button variant="outline" onClick={() => setChatOpen(true)} className="app-button call-mobile-chat" aria-label={t('room.chat.open')}>
            <MessageSquare size={16} /><span>{t('room.tab.chat')}</span>{unread > 0 && <i className="unread-dot" />}
          </Button>
          <Button variant="destructive" onClick={handleLeave} className="app-button call-leave"><PhoneOff size={16} />{t('room.action.leave')}</Button>
        </div>
      </footer>
      <Dialog open={chatOpen} onOpenChange={setChatOpen}>
        <DialogContent animated={false} className="workspace mobile-chat-dialog" aria-describedby={undefined}>
          <div className="mobile-chat-heading"><MessageSquare size={16} /><DialogTitle>{t('room.tab.chat')}</DialogTitle></div>
          <ChatSection messages={state.messages} currentUser={user.username} onSend={sendMessage} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ParticipantTile({
  participant,
  isLocal,
  isSpeaking,
  isMuted,
  youLabel,
  volume,
  onVolumeChange,
}: {
  participant: Participant;
  isLocal: boolean;
  isSpeaking: boolean;
  isMuted: boolean;
  youLabel: string;
  volume: number;
  onVolumeChange: (volume: number) => void;
}) {
  const initial = (participant.identity[0] ?? '?').toUpperCase();
  const t = useT();
  return (
    <div className={cn('participant-tile', isSpeaking && !isMuted && 'speaking')}>
      <div className="participant-tile-top"><span>{isLocal ? t('ui.you') : t('ui.participant')}</span><span aria-label={t(isMuted ? 'ui.micMuted' : 'ui.micOn')}>{isMuted ? <MicOff size={14} /> : <Mic size={14} />}</span></div>
      <div className="participant-avatar">{initial}</div>
      <div className="participant-tile-bottom"><strong>{participant.identity}{isLocal && <small> {youLabel}</small>}</strong><span className="participant-status">{t(isMuted ? 'ui.micMuted' : isSpeaking ? 'ui.speaking' : 'ui.listening')}</span></div>
      {!isLocal && <ParticipantVolume identity={participant.identity} volume={volume} onChange={onVolumeChange} />}
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
  const t = useT();
  return (
    <div className={cn('participant-row', isSpeaking && !isMuted && 'speaking')}>
      <span className="participant-row-avatar">{initial}</span>
      <span className="participant-row-name">{participant.identity}{isLocal && <small> {youLabel}</small>}</span>
      <span aria-label={t(isMuted ? 'ui.micMuted' : 'ui.micOn')}>{isMuted ? <MicOff size={13} /> : <Mic size={13} />}</span>
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
    <button type="button" onClick={onClick} aria-pressed={active} className={cn('call-tab', active && 'selected')}>
      {icon}{label}{badge != null && <span className="app-count">{badge}</span>}{dot && <i className="unread-dot" />}
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
    <div className="chat-section">
      <div className="chat-messages" role="log" aria-label={t('room.tab.chat')}>
        {messages.length === 0 ? <div className="chat-empty"><MessageSquare size={22} strokeWidth={1.4} /><p>{t('room.chat.empty')}</p></div> : messages.map(m => (
          <div key={m.id} className={cn('chat-message', m.sender === currentUser && 'mine')}>
            <div className="chat-message-heading"><strong>{m.sender}{m.sender === currentUser && <small> {t('room.you')}</small>}</strong><time dateTime={new Date(m.ts).toISOString()}>{new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div>
            <p>{m.text}</p>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      {failed && <p role="alert" className="chat-error">{t('ui.chatError')}</p>}
      <form onSubmit={submit} className="chat-compose">
        <Input value={text} onChange={e => { setText(e.target.value); setFailed(false); }} placeholder={t('room.chat.placeholder')} aria-label={t('room.chat.placeholder')} aria-invalid={failed} />
        <Button type="submit" size="icon" disabled={!text.trim()} aria-label={t('room.chat.send')} className="app-button app-button-primary"><Send size={15} /></Button>
      </form>
    </div>
  );
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
