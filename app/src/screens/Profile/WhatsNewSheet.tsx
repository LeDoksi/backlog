import { Sheet } from '../../ui/Sheet';
import { WHATS_NEW, whatsNewDate } from '../../data/whatsNew';
import s from './WhatsNewSheet.module.css';

// «Что нового»: notable updates, newest first. The texts are in
// data/whatsNew.ts, so the list opens offline too.
export function WhatsNewSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} labelledBy="whats-new-title">
      <h2 id="whats-new-title" className={s.title}>Что нового</h2>
      <div className={s.list}>
        {WHATS_NEW.map((e) => (
          <article key={e.date} className={s.entry} aria-labelledby={`whats-new-${e.date}`}>
            <time className={s.date} dateTime={e.date}>{whatsNewDate(e.date)}</time>
            <h3 id={`whats-new-${e.date}`} className={s.h3}>{e.title}</h3>
            <ul className={s.points}>
              {e.points.map((p) => <li key={p} className={s.point}>{p}</li>)}
            </ul>
          </article>
        ))}
      </div>
    </Sheet>
  );
}
