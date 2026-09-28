import { useRef, useState } from 'react';
import { resolveCover } from '../../lib/covers';
import { downscaleCover } from '../../lib/imageDownscale';
import { ASSET_ROOT } from '../../config';
import s from './EditTitle.module.css';
import c from './CoverField.module.css';

export function CoverField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const file = useRef<HTMLInputElement>(null);
  const [byLink, setByLink] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFile(f: File | undefined) {
    if (!f) return;
    setError(null);
    if (!f.type.startsWith('image/')) { setError('Выбери файл изображения'); return; }
    try { onChange(await downscaleCover(f)); setByLink(false); }
    catch { setError('Не удалось загрузить изображение'); }
  }

  return (
    <div className={c.wrap}>
      <img className={c.preview} src={resolveCover(value, ASSET_ROOT)} alt="Текущая обложка" />
      <div className={c.side}>
        <span className={s.label}>Обложка</span>
        <div className={c.buttons}>
          <button type="button" className={c.upload} onClick={() => file.current?.click()}>Загрузить фото</button>
          <button type="button" className={c.link} aria-expanded={byLink} onClick={() => setByLink((v) => !v)}>По ссылке</button>
        </div>
        <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
        {byLink && (
          <input className={s.input} type="url" placeholder="https://…" aria-label="Ссылка на обложку"
            value={value.startsWith('data:') ? '' : value} onChange={(e) => onChange(e.target.value)} />
        )}
        {error && <span role="alert" className={s.error}>{error}</span>}
      </div>
    </div>
  );
}
