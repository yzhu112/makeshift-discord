import { useAuth } from '@/auth/AuthProvider';
import { UserAvatar } from '@/components/UserAvatar';
import { useT } from '@/i18n/I18nProvider';
import { ImagePlus, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

const clamp = (value: number) => Math.max(0, Math.min(100, value));

export function AvatarEditor({ name }: { name: string }) {
  const t = useT();
  const { avatar, avatarError, retryAvatar, updateProfile } = useAuth();
  const [source, setSource] = useState<{ url: string; image: HTMLImageElement }>();
  const [position, setPosition] = useState({ x: 50, y: 50, zoom: 1 });
  const [removed, setRemoved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<'image' | 'size' | 'save' | null>(null);
  const [saved, setSaved] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const selection = useRef(0);
  const drag = useRef<{ x: number; y: number } | undefined>(undefined);
  const busy = useRef(false);
  const dirty = !!source || removed;
  const cropSize = source ? Math.min(source.image.naturalWidth, source.image.naturalHeight) / position.zoom : 0;

  useEffect(() => () => { selection.current++; }, []);
  useEffect(() => () => { if (source) URL.revokeObjectURL(source.url); }, [source]);
  useEffect(() => {
    const context = canvas.current?.getContext('2d');
    if (!context || !source) return;
    const { naturalWidth: width, naturalHeight: height } = source.image;
    context.clearRect(0, 0, 256, 256);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(source.image, (width - cropSize) * position.x / 100,
      (height - cropSize) * position.y / 100, cropSize, cropSize, 0, 0, 256, 256);
  }, [source, position, cropSize]);

  async function choose(file: File | undefined) {
    if (!file || busy.current) return;
    setError(null); setSaved(false);
    if (!['image/png', 'image/jpeg'].includes(file.type)) { setError('image'); return; }
    const request = ++selection.current;
    const url = URL.createObjectURL(file);
    setLoading(true);
    const image = new Image();
    try {
      image.src = url;
      await image.decode();
      if (request !== selection.current) { URL.revokeObjectURL(url); return; }
      setPosition({ x: 50, y: 50, zoom: 1 });
      setSource({ url, image });
      setRemoved(false);
    } catch {
      URL.revokeObjectURL(url);
      if (request === selection.current) setError('image');
    } finally {
      if (request === selection.current) setLoading(false);
    }
  }

  function cancel() {
    selection.current++;
    setSource(undefined); setRemoved(false); setError(null); setSaved(false); setLoading(false);
  }

  async function save() {
    if (busy.current || !dirty || loading) return;
    busy.current = true; setPending(true); setError(null); setSaved(false);
    try {
      let value: string | null = null;
      if (!removed) {
        const element = canvas.current;
        if (!element) throw new Error('image');
        const blob = await new Promise<Blob>((resolve, reject) => element.toBlob(result => result ? resolve(result) : reject(new Error('image')), 'image/png'));
        if (blob.size > 512 * 1024) throw new Error('size');
        value = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(',')[1]);
          reader.onerror = () => reject(new Error('image'));
          reader.readAsDataURL(blob);
        });
      }
      await updateProfile({ avatar: value });
      setSource(undefined); setRemoved(false); setSaved(true);
    } catch (failure) {
      setError(failure instanceof Error && failure.message === 'size' ? 'size' : 'save');
    } finally { busy.current = false; setPending(false); }
  }

  return <section className="settings-section" aria-labelledby="avatar-heading">
    <h3 id="avatar-heading">{t('account.avatar')}</h3>
    <p className="settings-help">{t('account.avatarHelp')}</p>
    <div className="avatar-editor">
      <div className="avatar-editor-preview">
        {source && !removed ? <canvas ref={canvas} width={256} height={256} className="avatar-crop" aria-label={t('account.cropPreview')}
          onPointerDown={event => {
            if (pending) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = { x: event.clientX, y: event.clientY };
          }}
          onPointerMove={event => {
            if (!drag.current || !source || pending) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            const dx = event.clientX - drag.current.x, dy = event.clientY - drag.current.y;
            drag.current = { x: event.clientX, y: event.clientY };
            const xRange = source.image.naturalWidth - cropSize, yRange = source.image.naturalHeight - cropSize;
            setPosition(previous => ({ ...previous,
              x: xRange ? clamp(previous.x - dx / bounds.width * cropSize / xRange * 100) : 50,
              y: yRange ? clamp(previous.y - dy / bounds.height * cropSize / yRange * 100) : 50 }));
          }} onPointerUp={() => { drag.current = undefined; }} onPointerCancel={() => { drag.current = undefined; }}
          onLostPointerCapture={() => { drag.current = undefined; }} />
          : <UserAvatar name={name} avatar={removed ? null : avatar} className="settings-avatar-preview" />}
      </div>
      <div className="avatar-editor-controls">
        <input ref={input} type="file" accept="image/png,image/jpeg" className="sr-only" tabIndex={-1} aria-label={t('account.chooseImage')}
          onChange={event => { void choose(event.target.files?.[0]); event.target.value = ''; }} />
        <button type="button" className="settings-button" disabled={pending || loading} onClick={() => input.current?.click()}>
          <ImagePlus size={15} aria-hidden="true" />{t('account.chooseImage')}
        </button>
        {source && !removed && <div className="crop-controls">
          {(['zoom', 'x', 'y'] as const).map(axis => <label key={axis}>
            <span>{t(axis === 'zoom' ? 'account.zoom' : axis === 'x' ? 'account.horizontal' : 'account.vertical')}</span>
            <input type="range" min={axis === 'zoom' ? 1 : 0} max={axis === 'zoom' ? 4 : 100} step={axis === 'zoom' ? .01 : 1}
              value={position[axis]} disabled={pending} onChange={event => setPosition(previous => ({ ...previous, [axis]: Number(event.target.value) }))} />
          </label>)}
          <button type="button" className="settings-text-button" disabled={pending} onClick={() => setPosition({ x: 50, y: 50, zoom: 1 })}>
            <RotateCcw size={13} aria-hidden="true" />{t('account.resetCrop')}
          </button>
        </div>}
        {!source && avatar && !removed && <button type="button" className="settings-text-button" disabled={pending} onClick={() => { setRemoved(true); setSaved(false); setError(null); }}>{t('account.removeAvatar')}</button>}
        {avatarError && !dirty && <div className="settings-feedback" role="alert">{t('account.avatarLoadError')}
          <button type="button" className="settings-text-button" onClick={retryAvatar}>{t('account.retry')}</button>
        </div>}
        <p className="settings-help" role="status">{loading || (avatar === undefined && !avatarError && !dirty) ? t('account.loading') : source ? t('account.cropHelp') : removed ? t('account.removalPending') : ''}</p>
      </div>
    </div>
    <div className="settings-actions">
      <button type="button" className="settings-button primary" disabled={!dirty || pending || loading} onClick={() => void save()}>{t(pending ? 'account.saving' : 'account.saveAvatar')}</button>
      {dirty && <button type="button" className="settings-button" disabled={pending} onClick={cancel}>{t('account.cancel')}</button>}
      <span className={`settings-feedback ${error ? 'error' : saved ? 'success' : ''}`} role={error ? 'alert' : 'status'}>{error ? t(error === 'image' ? 'account.imageError' : error === 'size' ? 'account.imageTooLarge' : 'account.saveError') : saved ? t('account.saved') : ''}</span>
    </div>
  </section>;
}
