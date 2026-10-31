import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useT } from '@/i18n/I18nProvider';
import { Headphones, Mic, Settings, Square } from 'lucide-react';
import { useEffect, useRef, useState, type RefObject } from 'react';
import './audio-settings.css';
import { MicrophoneTest } from './MicrophoneTest';
import { savedNoiseMode, saveNoiseMode, type NoiseMode } from './preferences';

export type CallAudioSettings = {
  mode: NoiseMode;
  busy: boolean;
  onChange: (mode: NoiseMode) => Promise<void>;
  beginTest: () => Promise<() => Promise<void>>;
};

export function AudioSettings({ call, open: controlledOpen, onOpenChange, showTrigger = true, returnFocusRef }: {
  call?: CallAudioSettings;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showTrigger?: boolean;
  returnFocusRef?: RefObject<HTMLButtonElement | null>;
}) {
  const t = useT();
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const setOpen = onOpenChange ?? setLocalOpen;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {showTrigger && <DialogTrigger asChild>
        <button type="button" className="audio-settings-trigger" title={t('audio.title')} aria-label={t('audio.title')}>
          <Settings size={22} />
        </button>
      </DialogTrigger>}
      <DialogContent animated={false} className="audio-settings" onCloseAutoFocus={event => {
        if (returnFocusRef?.current) {
          event.preventDefault();
          returnFocusRef.current.focus();
        }
      }}>
        {open && <AudioSettingsBody call={call} />}
      </DialogContent>
    </Dialog>
  );
}

function AudioSettingsBody({ call }: { call?: CallAudioSettings }) {
  const t = useT();
  const [preferred, setPreferred] = useState(savedNoiseMode);
  const mode = call?.mode ?? preferred;
  const [status, setStatus] = useState<'idle' | 'starting' | 'listening'>('idle');
  const [activeMode, setActiveMode] = useState<NoiseMode>();
  const [level, setLevel] = useState(0);
  const [error, setError] = useState(false);
  const testRef = useRef<MicrophoneTest | null>(null);

  function stop() {
    testRef.current?.stop();
    testRef.current = null;
    setStatus('idle');
    setLevel(0);
    setActiveMode(undefined);
  }

  // Stop on close/unmount or mode changes; never leave monitoring running.
  useEffect(() => {
    stop();
    return () => { testRef.current?.stop(); testRef.current = null; };
  }, [mode, call?.busy]);
  useEffect(() => {
    const stopWhenHidden = () => { if (document.hidden) stop(); };
    document.addEventListener('visibilitychange', stopWhenHidden);
    return () => document.removeEventListener('visibilitychange', stopWhenHidden);
  }, []);

  async function changeMode(next: NoiseMode) {
    stop();
    setError(false);
    if (call) await call.onChange(next);
    else { saveNoiseMode(next); setPreferred(next); }
  }

  function start() {
    stop();
    setError(false);
    if (call?.busy) { setError(true); return; }
    setStatus('starting');
    const test = new MicrophoneTest({
      onLevel: value => { if (testRef.current === test) setLevel(value); },
      onMode: actual => {
        if (testRef.current !== test) return;
        setActiveMode(actual);
        setStatus('listening');
      },
      onError: () => {
        if (testRef.current !== test) return;
        stop();
        setError(true);
      },
    });
    testRef.current = test;
    void test.start(mode, undefined, call?.beginTest);
  }

  return (
    <>
      <header className="audio-header">
        <div className="audio-eyebrow">{t('audio.settings')}</div>
        <DialogTitle className="audio-title">{t('audio.title')}</DialogTitle>
        <DialogDescription className="audio-description">{t('audio.description')}</DialogDescription>
      </header>
      <div className="audio-body">
        <section className="audio-section">
          <div className="audio-row">
            <div><h3>{t('room.noise.label')}</h3><p>{t('audio.noiseHelp')}</p></div>
          </div>
          <div className="audio-modes" role="group" aria-label={t('room.noise.label')}>
            {(['rnnoise', 'browser'] as const).map(value => (
              <button key={value} type="button" aria-pressed={mode === value} disabled={call?.busy} onClick={() => void changeMode(value)}>
                {value === 'rnnoise' ? 'RNNoise' : t('room.noise.browser')}
              </button>
            ))}
          </div>
        </section>
        <section className="audio-section">
          <div className="audio-row">
            <div><h3>{t('audio.micTest')}</h3><p>{t('audio.testHelp')}</p></div>
            <Mic size={16} className="audio-muted" />
          </div>
          <div className="audio-test-panel">
            <div className="audio-row audio-test-status">
              <span><i className={status === 'listening' ? 'audio-dot active' : 'audio-dot'} />{t(`audio.${status}`)}</span>
              <span className="audio-mono">{activeMode === 'rnnoise' ? 'RNNoise' : activeMode === 'browser' ? t('room.noise.browser') : '—'}</span>
            </div>
            <div role="meter" aria-label={t('audio.level')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level)} className="audio-meter">
              {Array.from({ length: 32 }, (_, i) => <i key={i} className={level > i * 100 / 32 ? 'filled' : ''} />)}
            </div>
            <button type="button" className="audio-test-button" disabled={status === 'idle' && call?.busy} onClick={status === 'idle' ? start : stop}>
              {status === 'idle' ? <Mic size={14} /> : <Square size={12} />}
              {t(status === 'idle' ? 'audio.start' : 'audio.stop')}
            </button>
          </div>
          <p className="audio-note"><Headphones size={14} />{t('audio.headphones')}</p>
          {call && <p className="audio-note">{t('audio.inCall')}</p>}
          <div role="status" className="audio-feedback">
            {error ? t('audio.error') : activeMode === 'browser' && mode === 'rnnoise' ? t('room.noise.fallback') : ''}
          </div>
        </section>
      </div>
      <footer className="audio-footer">{t('audio.local')}</footer>
    </>
  );
}
