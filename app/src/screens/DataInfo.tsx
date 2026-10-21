import { useEffect, useState } from 'react';
import { Sheet } from '../ui/Sheet';
import { Skeleton } from '../ui/Skeleton';
import s from './DataInfo.module.css';

// «Как мы используем данные»: open from the sign-in screen and from the
// profile. Plain words about what the app keeps and where, not a legal
// document. The text lives in public/data-info.json (precached for offline)
// so it does not weigh on the JS budget; keep it in step with the schema
// (supabase/migrations) and the outside sources in lib/enrich.ts.
interface Info { sections: { title: string; text: string[] }[]; credits: string }

export function DataInfo({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!open || info) return;
    setFailed(false);
    fetch(import.meta.env.BASE_URL + 'data-info.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((body: Info) => setInfo(body), () => setFailed(true));
  }, [open, info]);

  return (
    <Sheet open={open} onClose={onClose} labelledBy="data-info-title">
      <h2 id="data-info-title" className={s.title}>Как мы используем данные</h2>
      {info ? (
        <div className={s.doc}>
          {info.sections.map((sec) => (
            <section key={sec.title} className={s.part}>
              <h3 className={s.h3}>{sec.title}</h3>
              {sec.text.map((t) => <p key={t} className={s.p}>{t}</p>)}
            </section>
          ))}
          <p className={s.small}>{info.credits}</p>
        </div>
      ) : failed ? <p role="alert" className={s.p}>Не получилось загрузить текст. Проверь сеть и открой ещё раз.</p>
        : <Skeleton kind="card" />}
    </Sheet>
  );
}
