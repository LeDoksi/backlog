import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { X } from '@phosphor-icons/react';
import { Button } from '../../ui/Button';
import { Switch } from '../../ui/Switch';
import { Confirm } from '../../ui/Confirm';
import { useHistoryEntry, rearmHistoryEntry } from '../../ui/history';
import { useTitles } from '../../data/titlesStore';
import { useUi } from '../../data/ui';
import { busy } from '../../data/busy';
import type { Title } from '../../lib/types';
import { CATEGORY_OPTIONS } from '../../data/labels';
import { CoverField } from './CoverField';
import { GenresField } from './GenresField';
import { PartsEditor } from './PartsEditor';
import { formFromTitle, patchFromForm, remapChecked, seasonal, validateForm, type EditForm, type FormErrors } from './editForm';
import s from './EditTitle.module.css';


export function EditTitle() {
  const id = useUi((u) => u.editTitleId);
  const title = useTitles((t) => (id ? t.titles.find((x) => x.id === id) : undefined));
  const open = !!id && !!title;
  const reduce = useReducedMotion();
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div key={id} className={s.root} role="dialog" aria-modal="true" aria-labelledby="edit-title-h"
          initial={reduce ? false : { y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={reduce ? { opacity: 0 } : { y: 40, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 420, damping: 34 }}>
          <EditBody title={title} />
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

const NONE: number[] = [];

function EditBody({ title }: { title: Title }) {
  const closeEdit = useUi((u) => u.closeEdit);
  const editTitle = useTitles((t) => t.editTitle);
  const checked = useTitles((t) => t.checked[title.id]) ?? NONE;
  // The form edits a snapshot: a remote change arriving mid-edit must not
  // rewrite fields under the person typing.
  const initial = useMemo(() => formFromTitle(title), [title.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [form, setForm] = useState<EditForm>(initial);
  const [errors, setErrors] = useState<FormErrors>({});
  const [asking, setAsking] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const dirty = Object.keys(patchFromForm(form, initial)).length > 0;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  useEffect(() => {
    busy.enter('edit');
    root.current?.querySelector<HTMLInputElement>('input[name="title"]')?.focus({ preventScroll: true });
    return () => busy.leave('edit');
  }, []);

  function requestClose() {
    if (dirtyRef.current) setAsking(true);
    else closeEdit();
  }

  useHistoryEntry(true, () => {
    if (dirtyRef.current) { rearmHistoryEntry(); setAsking(true); }
    else closeEdit();
  });

  const set = <K extends keyof EditForm>(k: K, v: EditForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  function save() {
    const errs = validateForm(form);
    setErrors(errs);
    if (Object.keys(errs).length) {
      root.current?.querySelector('[role="alert"]')?.scrollIntoView({ block: 'center' });
      return;
    }
    const patch = patchFromForm(form, initial);
    if (Object.keys(patch).length) editTitle(title.id, patch, patch.parts ? remapChecked(form, checked) ?? undefined : undefined);
    closeEdit();
  }

  const showParts = seasonal(form.category);
  const hasParts = form.parts.some((p) => p.name.trim() || p.year.trim());

  return (
    <div ref={root} className={s.frame} onKeyDown={(e) => { if (e.key === 'Escape' && !asking) { e.stopPropagation(); requestClose(); } }}>
      <div className={s.scroll}>
        <div className={s.head}>
          <button type="button" className={s.close} aria-label="Закрыть без сохранения" onClick={requestClose}><X size={20} /></button>
          <h1 id="edit-title-h" className={s.h1}>Редактирование</h1>
        </div>

        <section className={s.card}>
          <CoverField value={form.cover} onChange={(v) => set('cover', v)} />
        </section>

        <section className={s.card}>
          <label className={s.field}>
            <span className={s.label}>Название</span>
            <input name="title" className={s.input} value={form.title} onChange={(e) => set('title', e.target.value)}
              aria-invalid={!!errors.title} aria-describedby={errors.title ? 'err-title' : undefined} />
            {errors.title && <span id="err-title" role="alert" className={s.error}>{errors.title}</span>}
          </label>
          <label className={s.field}>
            <span className={s.label}>Оригинальное название</span>
            <input className={s.input} value={form.originalTitle} onChange={(e) => set('originalTitle', e.target.value)} />
          </label>
          <div className={s.field}>
            <span className={s.label} id="cat-label">Категория</span>
            <div role="radiogroup" aria-labelledby="cat-label" className={s.segments}>
              {CATEGORY_OPTIONS.map((c) => (
                <button key={c.value} type="button" role="radio" aria-checked={form.category === c.value}
                  className={form.category === c.value ? `${s.segment} ${s.segmentOn}` : s.segment} onClick={() => set('category', c.value)}>{c.label}</button>
              ))}
            </div>
          </div>
          <label className={`${s.field} ${s.year}`}>
            <span className={s.label}>Год</span>
            <input className={s.input} inputMode="numeric" value={form.year} onChange={(e) => set('year', e.target.value)}
              aria-invalid={!!errors.year} aria-describedby={errors.year ? 'err-year' : undefined} />
            {errors.year && <span id="err-year" role="alert" className={s.error}>{errors.year}</span>}
          </label>
          <GenresField value={form.genres} onChange={(v) => set('genres', v)} />
        </section>

        {showParts && (
          <section className={s.card}>
            <PartsEditor parts={form.parts} onChange={(v) => set('parts', v)} error={errors.parts} />
            <label className={s.field}>
              <span className={s.label}>Описание сезонов</span>
              <textarea className={s.textarea} rows={3} value={form.seasonInfo} onChange={(e) => set('seasonInfo', e.target.value)} />
            </label>
          </section>
        )}

        {form.category === 'game' && (
          <section className={s.card}>
            <label className={s.field}>
              <span className={s.label}>Платформы</span>
              <input className={s.input} placeholder="PC, PS5, Switch" value={form.platforms} onChange={(e) => set('platforms', e.target.value)} />
            </label>
          </section>
        )}

        {!(showParts && hasParts) && (
          <section className={`${s.card} ${s.flat}`}>
            <Switch label="Ещё не вышло" hint="Премьера впереди, смотреть пока нечего" checked={form.unreleased} onChange={(v) => set('unreleased', v)} />
          </section>
        )}

        <section className={s.card}>
          <label className={s.field}>
            <span className={s.label}>Синопсис</span>
            <textarea className={s.textarea} rows={5} value={form.synopsis} onChange={(e) => set('synopsis', e.target.value)} />
          </label>
        </section>
      </div>

      <div className={s.bar}>
        <Button variant="neutral" className={s.cancel} onClick={requestClose}>Отмена</Button>
        <Button className={s.save} onClick={save}>Сохранить</Button>
      </div>

      <Confirm open={asking} title="Отменить изменения?" text="Всё, что ты поменял в этой форме, пропадёт." confirm="Отменить" danger
        onCancel={() => setAsking(false)} onConfirm={() => { setAsking(false); closeEdit(); }} />
    </div>
  );
}
