import type { User } from '@/api';
import { AppHeader } from '@/components/AppHeader';
import { CopyCode } from '@/components/CopyCode';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useT } from '@/i18n/I18nProvider';
import { cn } from '@/lib/utils';
import type { Participant } from 'livekit-client';
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
import type { CSSProperties, FormEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { participantLayout, visibleParticipants } from './participantLayout';
import { ParticipantVolume } from './ParticipantVolume';
import type { ChatMessage } from './useRoom';
import { useActiveCall } from './ActiveCallProvider';

type Props = {
  user: User;
  roomName: string;
  onLeave: () => void;
};

export function RoomView({ user, roomName, onLeave }: Props) {
  const call = useActiveCall()!;
  const { microphoneBusy, startAudio, isTestingMicrophone, state, toggleMute, sendMessage, noiseBusy, noiseNotice,
    error, setError, getVolume, changeVolume, seenCount, setSeenCount } = call;
  const t = useT();
  const [tab, setTab] = useState<'people' | 'chat'>('people');
  const [chatOpen, setChatOpen] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const [gridWidth, setGridWidth] = useState(0);
  const visible = visibleParticipants(state.participants, state.activeSpeakerIds, state.lastSpoke);
  const hiddenCount = state.participants.length - visible.length;
  const tileCount = visible.length + (hiddenCount > 0 ? 1 : 0);
  const layout = participantLayout(tileCount, gridWidth);
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const observer = new ResizeObserver(([entry]) => setGridWidth(entry.contentRect.width));
    observer.observe(grid);
    return () => observer.disconnect();
  }, [tileCount > 0]);
  const room = user.rooms.find((r) => r.name === roomName);
  const unread = state.messages.length - seenCount;

  useEffect(() => {
    if (tab === 'chat' || chatOpen) setSeenCount(state.messages.length);
  }, [tab, chatOpen, state.messages.length]);

  function handleLeave() {
    onLeave();
  }

  const isConnected = state.connectionState === ConnectionState.Connected;
  const isReconnecting = state.connectionState === ConnectionState.Reconnecting;
  const isConnecting = state.connectionState === ConnectionState.Connecting || isReconnecting;
  const count = state.participants.length;
  const connectionLabel = error ? t('room.status.cannotConnect') : isReconnecting ? t('room.status.reconnecting') : isConnected ? t('ui.connected') : isConnecting ? t('room.status.connecting') : t('ui.disconnected');

  return (
    <div className="workspace call-page">
      <AppHeader section={roomName} username={user.username} />
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
              <div ref={gridRef} className="participant-grid" style={{
                '--participant-columns': layout.columns, '--participant-rows': layout.rows,
              } as CSSProperties}>
                {visible.map((p, index) => (
                  <ParticipantTile key={p.identity} style={{ gridColumn: `${layout.starts[index]} / span 2` }} participant={p} isLocal={p.identity === user.username}
                    isSpeaking={state.activeSpeakerIds.has(p.identity)}
                    isMuted={p.identity === user.username ? state.isMuted : !p.isMicrophoneEnabled}
                    youLabel={t('room.you')} volume={getVolume(p.identity)} onVolumeChange={volume => changeVolume(p.identity, volume)} />
                ))}
                {hiddenCount > 0 && (
                  <button type="button" className="participant-tile participant-more"
                    style={{ gridColumn: `${layout.starts[tileCount - 1]} / span 2` }}
                    onClick={() => setPeopleOpen(true)} aria-haspopup="dialog">
                    <Users size={28} strokeWidth={1.4} aria-hidden="true" />
                    <strong>{t('room.people.more', { count: hiddenCount })}</strong>
                    <span>{t('room.people.viewAll')}</span>
                  </button>
                )}
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
      <Dialog open={peopleOpen} onOpenChange={setPeopleOpen}>
        <DialogContent animated={false} className="workspace people-dialog" aria-describedby={undefined}>
          <DialogTitle>{t('room.people.viewAll')}</DialogTitle>
          <div className="people-dialog-list">
            {state.participants.map(p => (
              <div className="people-dialog-entry" key={p.identity}>
                <ParticipantRow participant={p} isLocal={p.identity === user.username}
                  isSpeaking={state.activeSpeakerIds.has(p.identity)}
                  isMuted={p.identity === user.username ? state.isMuted : !p.isMicrophoneEnabled} youLabel={t('room.you')} />
                {p.identity !== user.username && <ParticipantVolume identity={p.identity} volume={getVolume(p.identity)}
                  onChange={volume => changeVolume(p.identity, volume)} />}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
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
  style,
  participant,
  isLocal,
  isSpeaking,
  isMuted,
  youLabel,
  volume,
  onVolumeChange,
}: {
  style?: CSSProperties;
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
    <div style={style} className={cn('participant-tile', isSpeaking && !isMuted && 'speaking')}>
      <div className="participant-tile-top"><span>{isLocal ? t('ui.you') : t('ui.participant')}</span><span aria-label={t(isMuted ? 'ui.micMuted' : 'ui.micOn')}>{isMuted ? <MicOff size={14} /> : <Mic size={14} />}</span></div>
      <div className="participant-avatar">{initial}</div>
      <div className="participant-tile-bottom"><strong title={participant.identity}>{participant.identity}{isLocal && <small> {youLabel}</small>}</strong><span className="participant-status">{t(isMuted ? 'ui.micMuted' : isSpeaking ? 'ui.speaking' : 'ui.listening')}</span></div>
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
  const { chatDraft: text, setChatDraft: setText } = useActiveCall()!;
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
