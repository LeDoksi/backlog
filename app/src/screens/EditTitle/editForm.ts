import type { Category, Part, Title } from '../../lib/types';

export interface FormPart { key: number; name: string; year: string; released: boolean }
export interface EditForm {
  title: string;
  originalTitle: string;
  category: Category;
  year: string;
  genres: string[];
  cover: string;
  platforms: string;
  seasonInfo: string;
  synopsis: string;
  parts: FormPart[];
  unreleased: boolean;
}

let partKey = 1;
export const newPart = (p?: Partial<Part>): FormPart => ({
  key: partKey++, name: p?.name ?? '', year: p?.year != null ? String(p.year) : '', released: p?.released !== false
});

export function formFromTitle(t: Title): EditForm {
  return {
    title: t.title ?? '',
    originalTitle: t.originalTitle ?? '',
    category: t.category,
    year: t.year != null ? String(t.year) : '',
    genres: [...(t.genres ?? [])],
    cover: t.cover ?? '',
    platforms: (t.platforms ?? []).join(', '),
    seasonInfo: t.seasonInfo ?? '',
    synopsis: t.synopsis ?? '',
    parts: (t.parts ?? []).map((p) => newPart(p)),
    unreleased: t.status === 'unreleased'
  };
}

export const seasonal = (c: Category) => c === 'series' || c === 'anime';

// The title fields each form value becomes. A part with neither name nor year
// is an empty row someone added and never filled, not a part.
function values(f: EditForm): Record<string, unknown> {
  return {
    title: f.title.trim(),
    originalTitle: f.originalTitle.trim(),
    category: f.category,
    year: f.year.trim() ? parseInt(f.year, 10) : null,
    genres: f.genres,
    cover: f.cover.trim(),
    platforms: f.platforms.split(',').map((s) => s.trim()).filter(Boolean),
    seasonInfo: f.seasonInfo.trim(),
    synopsis: f.synopsis,
    parts: f.parts
      .filter((p) => p.name.trim() || p.year.trim())
      .map((p) => ({ name: p.name.trim(), year: p.year.trim() ? parseInt(p.year, 10) : null, released: p.released })),
    unreleased: f.unreleased
  };
}

/** Only what changed. "Ещё не вышло" is not a field: it becomes a status write. */
export function patchFromForm(form: EditForm, initial: EditForm): Partial<Title> {
  const now = values(form), was = values(initial);
  const patch: Record<string, unknown> = {};
  Object.keys(now).forEach((k) => {
    if (JSON.stringify(now[k]) === JSON.stringify(was[k])) return;
    if (k === 'unreleased') patch.status = now.unreleased ? 'unreleased' : 'queue';
    else patch[k] = now[k];
  });
  return patch as Partial<Title>;
}

export type FormErrors = Partial<Record<'title' | 'year' | 'parts', string>>;

export function validateForm(f: EditForm): FormErrors {
  const errors: FormErrors = {};
  if (!f.title.trim()) errors.title = 'Нужно название';
  const y = f.year.trim();
  if (y && !/^\d{4}$/.test(y)) errors.year = 'Год из четырёх цифр';
  if (seasonal(f.category) && f.parts.some((p) => p.year.trim() && !/^\d{4}$/.test(p.year.trim()))) errors.parts = 'У части год из четырёх цифр';
  return errors;
}
