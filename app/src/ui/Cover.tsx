import { useState, type ImgHTMLAttributes } from 'react';
import { isLandscapeCover } from '../lib/covers';
import s from './Cover.module.css';

/**
 * A poster image for a 2:3 slot. A wide picture (a game's Steam header,
 * say: spec 3.2) is shown whole, centred on a blurred copy of itself,
 * rather than cropped to its middle. Known wide covers are recognised by
 * address; any other picture that turns out wide on load switches too.
 */
export function Cover({ src, onLoad, ...img }: ImgHTMLAttributes<HTMLImageElement> & { src: string }) {
  const [wide, setWide] = useState<{ src: string; wide: boolean } | null>(null);
  const landscape = wide?.src === src ? wide.wide : isLandscapeCover(src);
  return (
    <span className={landscape ? `${s.frame} ${s.landscape}` : s.frame}>
      {landscape && <img className={s.blur} src={src} alt="" aria-hidden="true" draggable={false} />}
      <img {...img} src={src} className={s.img}
        onLoad={(e) => {
          const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
          if (w && h) setWide({ src, wide: w > h * 1.1 });
          onLoad?.(e);
        }} />
    </span>
  );
}
