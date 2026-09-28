import s from './Avatar.module.css';

export function avatarSlot(userId: string): number {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return (h % 6) + 1;
}

export function Avatar({ userId, name, size = 40 }: { userId: string; name: string; size?: number }) {
  const letter = (name.trim()[0] ?? '?').toUpperCase();
  return (
    <span className={s.avatar} aria-hidden="true"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38), background: `var(--avatar-${avatarSlot(userId)})` }}>
      {letter}
    </span>
  );
}
