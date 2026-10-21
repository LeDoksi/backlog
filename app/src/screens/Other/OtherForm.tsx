import { useEffect, useMemo, useState } from 'react';
import { Plus, X } from '@phosphor-icons/react';
import { Sheet } from '../../ui/Sheet';
import { Button } from '../../ui/Button';
import { Chip } from '../../ui/Chip';
import { Segmented } from '../../ui/Segmented';
import { useOther } from '../../data/otherStore';
import { busy } from '../../data/busy';
import {
  OTHER_LIMITS, OTHER_STATUS_LABEL, checkOtherDraft, otherErrorText, matchCategory, normalizeLink, otherCategories,
  type OtherDraft, type OtherField, type OtherStatus
} from '../../lib/other';
import s from './Other.module.css';

const EMPTY: OtherDraft = { title: '', category: '', description: '', links: [], status: 'want', rating: null };

// A new line of «Другое», or a change to one's own: name, category (typed,
// or picked from the board's own), description, up to three links.
export function OtherForm() {
  const form = useOther((o) => o.form);
  const items = useOther((o) => o.items);
  const open = form !== null;
  const editing = form?.id ? items.find((i) => i.id === form.id) : undefined;
  const [draft, setDraft] = useState<OtherDraft>(EMPTY);
  const [links, setLinks] = useState<string[]>(['']);
  const [errors, setErrors] = useState<Partial<Record<OtherField, string>>>({});
  const [failed, setFailed] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const categories = useMemo(() => otherCategories(items), [items]);

  useEffect(() => {
    if (!open) return;
    const { mine: _mine, ...start } = editing ?? { ...EMPTY, mine: true };
    setDraft(start);
    setLinks(start.links.length ? start.links : ['']);
    setErrors({});
    setFailed(null);
    setSaving(false);
    busy.enter('sheet');
    return () => busy.leave('sheet');
    // Filled once per opening: a list re-read under the form must not wipe what is typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, form?.id]);

  const close = () => useOther.getState().openForm(null);
  const set = (p: Partial<OtherDraft>) => setDraft((d) => ({ ...d, ...p }));

  async function save() {
    const next: OtherDraft = {
      ...draft,
      title: draft.title.trim(),
      category: matchCategory(draft.category, items),
      description: draft.description.trim(),
      links: links.map(normalizeLink).filter(Boolean)
    };
    const bad = checkOtherDraft(next);
    setErrors(bad);
    setFailed(null);
    if (Object.keys(bad).length) return;
    setSaving(true);
    const res = await useOther.getState().save(next);
    setSaving(false);
    if (!res.ok) { setFailed(otherErrorText(res.error)); return; }
    close();
  }

  const field = (name: OtherField) => (errors[name] ? { 'aria-invalid': true as const, 'aria-describedby': `other-${name}-error` } : {});
  const error = (name: OtherField) => errors[name] && <p id={`other-${name}-error`} className={s.error}>{errors[name]}</p>;

  return (
    <Sheet open={open} onClose={close} labelledBy="other-form-title" footer={(
      <>
        <Button variant="neutral" className={s.footBtn} onClick={close}>Отмена</Button>
        <Button className={s.footBtn} disabled={saving} onClick={() => void save()}>{saving ? 'Сохраняю…' : 'Сохранить'}</Button>
      </>
    )}>
      <h2 id="other-form-title" className={s.title}>{editing ? 'Изменить запись' : 'Новая запись'}</h2>
      <form className={s.form} noValidate onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <div className={s.field}>
          <label htmlFor="other-title" className={s.label}>Название</label>
          <input id="other-title" className={s.input} value={draft.title} maxLength={OTHER_LIMITS.title}
            onChange={(e) => set({ title: e.target.value })} {...field('title')} />
          {error('title')}
        </div>
        <div className={s.field}>
          <label htmlFor="other-category" className={s.label}>Категория</label>
          <input id="other-category" className={s.input} value={draft.category} maxLength={OTHER_LIMITS.category}
            placeholder="Книги, рестораны, театр…" onChange={(e) => set({ category: e.target.value })} {...field('category')} />
          {error('category')}
          {categories.length > 0 && (
            <div className={s.suggest} role="group" aria-label="Категории на доске">
              {categories.map((c) => (
                <Chip key={c.name} selected={draft.category.trim().toLowerCase() === c.name.toLowerCase()}
                  onClick={() => set({ category: c.name })}>{c.name}</Chip>
              ))}
            </div>
          )}
        </div>
        <div className={s.field}>
          <span className={s.label}>Статус</span>
          <Segmented label="Статус" value={draft.status} onChange={(v: OtherStatus) => set({ status: v })}
            options={(['want', 'done'] as const).map((v) => ({ value: v, label: OTHER_STATUS_LABEL[v] }))} />
        </div>
        <div className={s.field}>
          <label htmlFor="other-description" className={s.label}>Описание</label>
          <textarea id="other-description" className={s.textarea} value={draft.description} maxLength={OTHER_LIMITS.description}
            onChange={(e) => set({ description: e.target.value })} {...field('description')} />
          {error('description')}
        </div>
        <div className={s.field}>
          <span className={s.label}>Ссылки</span>
          {links.map((l, i) => (
            <div key={i} className={s.linkRow}>
              <input className={s.input} type="url" inputMode="url" value={l} placeholder="https://" aria-label={`Ссылка ${i + 1}`}
                maxLength={OTHER_LIMITS.link} onChange={(e) => setLinks(links.map((x, j) => (j === i ? e.target.value : x)))} {...field('links')} />
              {(links.length > 1 || l) && (
                <button type="button" className={s.remove} aria-label={`Убрать ссылку ${i + 1}`}
                  onClick={() => setLinks(links.length > 1 ? links.filter((_, j) => j !== i) : [''])}><X size={18} /></button>
              )}
            </div>
          ))}
          {error('links')}
          {links.length < OTHER_LIMITS.links && (
            <button type="button" className={s.addLink} onClick={() => setLinks([...links, ''])}><Plus size={18} aria-hidden="true" />Ещё ссылка</button>
          )}
        </div>
        {failed && <p className={s.error} role="alert">{failed}</p>}
      </form>
    </Sheet>
  );
}
