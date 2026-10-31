import { Button } from '@/components/ui/button';
import { useT } from '@/i18n/I18nProvider';
import { ConnectionState } from 'livekit-client';
import { AudioLines, Maximize2, MessageSquare, Mic, MicOff, PhoneOff, Volume2 } from 'lucide-react';
import { useActiveCall } from './ActiveCallProvider';
import './call-dock.css';

export function CallDock({ onReturn, onLeave }: { onReturn: () => void; onLeave: () => void }) {
  const call = useActiveCall()!;
  const t = useT();
  const { state, error, roomName, noiseBusy, microphoneBusy, isTestingMicrophone } = call;
  const connected = state.connectionState === ConnectionState.Connected;
  const label = error ? t('room.status.cannotConnect')
    : state.connectionState === ConnectionState.Reconnecting ? t('room.status.reconnecting')
    : state.connectionState === ConnectionState.Connecting ? t('room.status.connecting')
    : connected ? t('ui.connected') : t('ui.disconnected');
  const unread = Math.max(0, state.messages.length - call.seenCount);
  const muteLabel = t(microphoneBusy ? 'room.microphone.starting' : state.microphoneIssue && state.isMuted ? 'room.microphone.enable' : state.isMuted ? 'room.action.unmute' : 'room.action.mute');
  return <aside className="call-dock" aria-label={t('callDock.label')}>
    <button type="button" className="call-dock-return" onClick={onReturn} aria-label={t('callDock.return', { name: roomName ?? '' })} title={t('callDock.return', { name: roomName ?? '' })}>
      <span className={`call-dock-icon ${connected && !error ? 'connected' : ''}`}><AudioLines size={19} aria-hidden="true" /></span>
      <span className="call-dock-summary">
        <strong>{roomName}</strong>
        <span className="call-dock-status" role="status">{label}<span aria-hidden="true"> · </span>{t('room.sidebar.inRoom', { count: state.participants.length })}</span>
      </span>
      {unread > 0 && <span className="call-dock-unread" aria-label={t('callDock.unread', { count: unread })}><MessageSquare size={13} aria-hidden="true" />{unread}</span>}
      <Maximize2 size={14} className="call-dock-expand" aria-hidden="true" />
    </button>
    <div className="call-dock-actions">
      {!state.canPlaybackAudio && connected && <Button variant="ghost" size="icon" title={t('room.volume.enableAudio')} aria-label={t('room.volume.enableAudio')} onClick={() => void call.startAudio().catch(() => call.setError(t('room.volume.playbackError')))}><Volume2 size={16} /></Button>}
      <Button variant="outline" size="icon" disabled={!connected || noiseBusy || microphoneBusy || isTestingMicrophone} onClick={() => void call.toggleMute()} aria-pressed={state.isMuted} aria-label={muteLabel} title={muteLabel}>
        {state.isMuted ? <MicOff size={16} /> : <Mic size={16} />}
      </Button>
      <Button variant="destructive" size="icon" onClick={onLeave} title={t('room.action.leave')} aria-label={t('room.action.leave')}><PhoneOff size={16} /></Button>
    </div>
  </aside>;
}
