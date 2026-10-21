import { Button } from '../ui/Button';
import s from './NotInvited.module.css';

export function NotInvited({ onSignOut, linkExpired = false }: { onSignOut: () => void; linkExpired?: boolean }) {
  return (
    <div className={s.screen}>
      <h1 className={s.title}>Этот аккаунт пока не приглашён</h1>
      <p className={s.text}>{linkExpired
        ? 'Ссылка-приглашение устарела или уже использована: каждая пускает одного человека и действует 7 дней. Попроси у владельца новую и открой её снова.'
        : 'Бэклог — закрытый клуб для друзей. Попроси владельца пригласить твою почту, а потом войди снова.'}</p>
      <Button variant="neutral" onClick={onSignOut}>Выйти</Button>
    </div>
  );
}
