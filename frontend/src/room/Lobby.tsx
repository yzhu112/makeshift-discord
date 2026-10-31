import type { User } from '@/api';
import { ApiError, api } from '@/api';
import { useAuth } from '@/auth/AuthProvider';
import { AppHeader } from '@/components/AppHeader';
import { CopyCode } from '@/components/CopyCode';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useT } from '@/i18n/I18nProvider';
import { cn } from '@/lib/utils';
import { ArrowUpRight, Globe, Lock, Plus, UserPlus, Volume2 } from 'lucide-react';
import type { FormEvent } from 'react';
import { useState } from 'react';

type Props = {
  user: User;
  onJoin: (roomName: string) => void;
};

export function Lobby({ user, onJoin }: Props) {
  const { refresh } = useAuth();
  const t = useT();
  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);

  return (
    <div className="workspace lobby-page">
      <AppHeader section={t('lobby.channels')} username={user.username} />
      <main className="lobby-main">
        <div className="workspace-heading">
          <div>
            <p className="app-eyebrow">{t('ui.workspace')}</p>
            <h1>{t('lobby.channels')}</h1>
            <p>{t('lobby.greeting', { name: user.username })} {t('ui.lobbyDescription')}</p>
          </div>
          <div className="workspace-actions">
            <Button variant="outline" className="app-button" onClick={() => setJoinOpen(true)}>
              <UserPlus size={15} />{t('lobby.action.join')}
            </Button>
            <Button className="app-button app-button-primary" onClick={() => setCreateOpen(true)}>
              <Plus size={15} />{t('lobby.action.new')}
            </Button>
          </div>
        </div>
        <section className="channel-panel" aria-label={t('lobby.channels')}>
          <div className="channel-panel-heading">
            <span>{t('ui.yourChannels')} <span className="app-count">{user.rooms.length}</span></span>
            <span>{t('ui.channelAccess')}</span>
          </div>
          {user.rooms.length === 0 ? (
            <div className="app-empty"><Volume2 size={24} strokeWidth={1.4} /><p>{t('lobby.empty')}</p></div>
          ) : (
            <div className="channel-list">
              {user.rooms.map(room => (
                <div className="channel-row" key={room.name}>
                  <button type="button" className="channel-open" onClick={() => onJoin(room.name)} aria-label={t('ui.enterChannel', { name: room.name })}>
                    <span className="channel-icon">{room.code ? <Lock size={18} /> : <Volume2 size={18} />}</span>
                    <span className="channel-name"><strong>{room.name}</strong><small>{t('ui.voiceChannel')}</small></span>
                    <span className="channel-access"><span className="app-badge">{t(room.code ? 'lobby.create.protected' : 'lobby.create.regular')}</span></span>
                    <ArrowUpRight className="channel-arrow" size={17} />
                  </button>
                  {room.code && <div className="channel-code"><CopyCode code={room.code} /></div>}
                </div>
              ))}
            </div>
          )}
        </section>
        <div className="lobby-bottom">
          <p>{t('ui.lobbyHint')}</p>
        </div>
      </main>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent animated={false} className="workspace app-form-dialog">
          <CreateRoom
            onClose={() => setCreateOpen(false)}
            onDone={refresh}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={joinOpen} onOpenChange={setJoinOpen}>
        <DialogContent animated={false} className="workspace app-form-dialog">
          <JoinRoom
            onClose={() => setJoinOpen(false)}
            onDone={refresh}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CreateRoom({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const t = useT();
  const [roomName, setRoomName] = useState('');
  const [isProtected, setIsPrivate] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await api<{ roomName: string; code: string | null }>(
        '/api/create-room',
        { method: 'POST', body: JSON.stringify({ roomName, isProtected }) },
      );
      await onDone();
      if (res.code) setCode(res.code);
      else onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('lobby.error.create'));
    } finally {
      setSubmitting(false);
    }
  }

  if (code) {
    return (
      <div className="space-y-4">
        <DialogHeader>
          <DialogTitle>{t('lobby.create.success')}</DialogTitle>
        </DialogHeader>
        <div className="flex justify-center rounded-lg border bg-muted/40 py-3">
          <CopyCode code={code} className="text-base tracking-[0.3em]" />
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>{t('lobby.create.title')}</DialogTitle>
      </DialogHeader>
      <Input
        className="max-sm:h-12"
        value={roomName}
        onChange={(e) => setRoomName(e.target.value)}
        placeholder={t('lobby.create.name')}
        aria-label={t('lobby.create.name')}
        autoFocus
        required
      />
      <Segmented
        value={isProtected}
        onChange={setIsPrivate}
        regularLabel={t('lobby.create.regular')}
        protectedLabel={t('lobby.create.protected')}
      />
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" size="sm" className="app-button app-button-primary w-full" disabled={submitting}>
        {submitting ? t('lobby.create.submitting') : t('lobby.create.submit')}
      </Button>
    </form>
  );
}

function Segmented({
  value,
  onChange,
  regularLabel,
  protectedLabel,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  regularLabel: string;
  protectedLabel: string;
}) {
  const base =
    'flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2.5 text-sm font-medium transition-colors sm:py-1.5 sm:text-xs';
  return (
    <div className="flex rounded-lg border p-0.5">
      <button
        type="button"
        aria-pressed={!value}
        onClick={() => onChange(false)}
        className={cn(
          base,
          value
            ? 'text-muted-foreground hover:text-foreground'
            : 'bg-muted text-foreground',
        )}
      >
        <Globe className="h-3 w-3" />
        {regularLabel}
      </button>
      <button
        type="button"
        aria-pressed={value}
        onClick={() => onChange(true)}
        className={cn(
          base,
          value
            ? 'bg-muted text-foreground'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <Lock className="h-3 w-3" />
        {protectedLabel}
      </button>
    </div>
  );
}

function JoinRoom({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const t = useT();
  const [roomName, setRoomName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const body: { roomName: string; code?: string } = { roomName };
      if (code) body.code = code;
      await api('/api/join-room', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      await onDone();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('lobby.error.join'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>{t('lobby.join.title')}</DialogTitle>
      </DialogHeader>
      <Input
        className="max-sm:h-12"
        value={roomName}
        onChange={(e) => setRoomName(e.target.value)}
        placeholder={t('lobby.join.name')}
        aria-label={t('lobby.join.name')}
        autoFocus
        required
      />
      <Input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder={t('lobby.join.code')}
        aria-label={t('lobby.join.code')}
        className="font-mono tracking-[0.2em] placeholder:font-sans placeholder:tracking-normal max-sm:h-12"
      />
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" size="sm" className="app-button app-button-primary w-full" disabled={submitting}>
        {submitting ? t('lobby.join.submitting') : t('lobby.join.submit')}
      </Button>
    </form>
  );
}
