import s from './Switch.module.css';

interface Props { checked: boolean; onChange: (next: boolean) => void; label: string; hint?: string }

export function Switch({ checked, onChange, label, hint }: Props) {
  return (
    <div className={s.row}>
      <div className={s.text}>
        <span className={s.label}>{label}</span>
        {hint && <span className={s.hint}>{hint}</span>}
      </div>
      <button type="button" role="switch" aria-checked={checked} aria-label={label}
        className={checked ? `${s.track} ${s.on}` : s.track} onClick={() => onChange(!checked)}>
        <span className={s.thumb} />
      </button>
    </div>
  );
}
