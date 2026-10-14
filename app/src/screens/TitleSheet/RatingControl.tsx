import s from './RatingControl.module.css';

const MARKS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

interface Props { value: number | null; prompt: boolean; onChange(v: number | null): void }

/** My own 1–10 (spec 1.9). `prompt`: just finished and not rated yet, so the row asks and stands out. */
export function RatingControl({ value, prompt, onChange }: Props) {
  const label = prompt ? 'Как тебе?' : 'Оценка';
  return (
    <section className={prompt ? `${s.box} ${s.prompt}` : s.box}>
      <h3 id="rating-title" className={s.title}>{label}</h3>
      <div role="radiogroup" aria-labelledby="rating-title" className={s.marks}>
        {MARKS.map((n) => (
          <button key={n} type="button" role="radio" aria-checked={value === n} className={value === n ? `${s.mark} ${s.on}` : s.mark}
            onClick={() => onChange(value === n ? null : n)}>{n}</button>
        ))}
      </div>
    </section>
  );
}
