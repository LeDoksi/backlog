import { Button } from '../ui/Button';
import s from './NotInvited.module.css';

export function NotInvited({ onSignOut }: { onSignOut: () => void }) {
  return (
    <div className={s.screen}>
      <h1 className={s.title}>Этот аккаунт пока не приглашён</h1>
      <p className={s.text}>Попроси владельца бэклога пригласить твою почту, а потом войди снова.</p>
      <Button variant="neutral" onClick={onSignOut}>Выйти</Button>
    </div>
  );
}
