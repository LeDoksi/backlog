import s from './Skeleton.module.css';

export function Skeleton({ kind }: { kind: 'card' | 'row' }) {
  if (kind === 'row') return <div className={`${s.shimmer} ${s.row}`} aria-hidden="true" />;
  return (
    <div className={s.card} aria-hidden="true">
      <div className={`${s.shimmer} ${s.poster}`} />
      <div className={`${s.shimmer} ${s.line}`} />
      <div className={`${s.shimmer} ${s.lineShort}`} />
    </div>
  );
}
