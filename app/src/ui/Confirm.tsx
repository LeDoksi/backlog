import { useEffect, useRef } from 'react';
import { Button } from './Button';
import s from './Confirm.module.css';

interface Props { open: boolean; title: string; text?: string; confirm: string; danger?: boolean; onConfirm: () => void; onCancel: () => void }

// Native <dialog>: modal focus trap, Esc and the top layer come for free,
// and it stacks above an open sheet without z-index games.
export function Confirm({ open, title, text, confirm, danger = false, onConfirm, onCancel }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal?.();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className={s.dialog} aria-labelledby="confirm-title" onCancel={(e) => { e.preventDefault(); onCancel(); }}
      onKeyDown={(e) => e.stopPropagation()}>
      {open && (
        <div className={s.inner}>
          <h2 id="confirm-title" className={s.title}>{title}</h2>
          {text && <p className={s.text}>{text}</p>}
          <div className={s.actions}>
            <Button variant="neutral" className={s.btn} onClick={onCancel} autoFocus>Отмена</Button>
            <Button variant={danger ? 'danger' : 'primary'} className={s.btn} onClick={onConfirm}>{confirm}</Button>
          </div>
        </div>
      )}
    </dialog>
  );
}
