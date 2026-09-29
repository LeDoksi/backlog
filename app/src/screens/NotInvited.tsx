import { Button } from '../ui/Button';
import s from './NotInvited.module.css';

export function NotInvited({ onSignOut, linkExpired = false }: { onSignOut: () => void; linkExpired?: boolean }) {
  return (
    <div className={s.screen}>
      <h1 className={s.title}>Этот аккаунт пока не приглашён</h1>
      <p className={s.text}>{linkExpired
        ? 'Ссылка-приглашение устарела: они действуют 7 дней. Попроси у друга новую и открой её снова.'
        : 'Попроси владельца бэклога пригласить твою почту, а потом войди снова.'}</p>
      <Button variant="neutral" onClick={onSignOut}>Выйти</Button>
    </div>
  );
}
