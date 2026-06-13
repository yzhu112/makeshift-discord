import type { FormEvent } from 'react';
import { useState } from 'react';
import { Globe, Lock, Plus, UserPlus, Volume2 } from 'lucide-react';
import { ApiError, api } from '@/api';
import type { User } from '@/api';
import { useAuth } from '@/auth/AuthProvider';
import { CopyCode } from '@/components/CopyCode';
import { SettingsBar } from '@/components/SettingsBar';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useT } from '@/i18n/I18nProvider';
import { cn } from '@/lib/utils';

type Props = {
  user: User;
  onJoin: (roomName: string) => void;
};

const SECTION_LABEL =
  'text-[10px] font-medium tracking-[0.18em] text-muted-foreground uppercase';

export function Lobby({ user, onJoin }: Props) {
  const { logout, refresh } = useAuth();
  const t = useT();
  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);

  return (
    <div className="flex min-h-svh flex-col bg-background sm:items-center sm:justify-center sm:px-4 sm:py-12">
      <SettingsBar floating />
      <Card className="flex w-full flex-1 flex-col gap-0 overflow-visible rounded-none py-0 shadow-none ring-0 sm:max-w-md sm:flex-none sm:overflow-hidden sm:rounded-xl sm:shadow-sm sm:ring-1">
        <CardHeader className="shrink-0 space-y-2 border-b bg-muted/40 px-6 pb-7 pt-[max(env(safe-area-inset-top),2.25rem)] sm:py-7">
          <p className="text-[10px] font-medium tracking-[0.22em] text-muted-foreground uppercase">
            {t('auth.brand')}
          </p>
          <CardTitle className="font-heading text-4xl font-normal italic tracking-tight sm:text-3xl">
            {t('lobby.greeting', { name: user.username })}
          </CardTitle>
        </CardHeader>

        <CardContent className="flex flex-1 flex-col px-6 pt-6 pb-6 sm:flex-none sm:pt-5 sm:pb-5">
          <div className="flex flex-col gap-2.5 sm:flex-row sm:gap-2">
            <Button
              className="h-auto flex-1 py-3 text-sm sm:h-9 sm:py-0 sm:text-[0.8rem]"
              onPointerUp={(e) => {
                if (e.button === 0) setCreateOpen(true);
              }}
              onClick={(e) => {
                if (e.detail === 0) setCreateOpen(true);
              }}
            >
              <Plus className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
              {t('lobby.action.new')}
            </Button>
            <Button
              variant="outline"
              className="h-auto flex-1 py-3 text-sm sm:h-9 sm:py-0 sm:text-[0.8rem]"
              onPointerUp={(e) => {
                if (e.button === 0) setJoinOpen(true);
              }}
              onClick={(e) => {
                if (e.detail === 0) setJoinOpen(true);
              }}
            >
              <UserPlus className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
              {t('lobby.action.join')}
            </Button>
          </div>

          <p className={`mt-7 mb-3 sm:mt-5 ${SECTION_LABEL}`}>{t('lobby.channels')}</p>

          {user.rooms.length === 0 ? (
            <p className="px-1 py-1.5 text-sm text-muted-foreground">
              {t('lobby.empty')}
            </p>
          ) : (
            <div className="space-y-2 sm:space-y-0.5">
              {user.rooms.map((room) => (
                <div
                  key={room.name}
                  className="flex items-center gap-1 rounded-xl border bg-card pr-2 transition-all hover:bg-muted/60 active:scale-[0.98] active:bg-muted sm:rounded-lg sm:border-0 sm:bg-transparent sm:pr-1.5"
                >
                  <button
                    type="button"
                    onPointerUp={(e) => {
                      if (e.button === 0) onJoin(room.name);
                    }}
                    onClick={(e) => {
                      if (e.detail === 0) onJoin(room.name);
                    }}
                    className="flex flex-1 items-center gap-3 px-4 py-4 text-left sm:gap-2.5 sm:px-3 sm:py-2.5"
                  >
                    {room.code
                      ? <Lock className="h-4 w-4 text-muted-foreground sm:h-3.5 sm:w-3.5" />
                      : <Volume2 className="h-4 w-4 text-muted-foreground sm:h-3.5 sm:w-3.5" />}
                    <span className="text-base font-medium sm:text-sm">{room.name}</span>
                  </button>
                  {room.code && <CopyCode code={room.code} />}
                </div>
              ))}
            </div>
          )}
        </CardContent>

        <CardFooter className="sticky bottom-0 shrink-0 justify-end border-t bg-card px-6 pt-4 pb-[max(env(safe-area-inset-bottom),1.5rem)] sm:static sm:border-t-0 sm:bg-transparent sm:pb-6">
          <button
            type="button"
            onClick={logout}
            className="text-xs text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
          >
            {t('lobby.logout')}
          </button>
        </CardFooter>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <CreateRoom
            onClose={() => setCreateOpen(false)}
            onDone={refresh}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={joinOpen} onOpenChange={setJoinOpen}>
        <DialogContent>
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
      <Button type="submit" size="sm" className="h-auto w-full py-3 text-sm sm:h-7 sm:py-0 sm:text-[0.8rem]" disabled={submitting}>
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
      <Button type="submit" size="sm" className="h-auto w-full py-3 text-sm sm:h-7 sm:py-0 sm:text-[0.8rem]" disabled={submitting}>
        {submitting ? t('lobby.join.submitting') : t('lobby.join.submit')}
      </Button>
    </form>
  );
}
