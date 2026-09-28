import { useState } from 'react';
import { Avatar } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { getSupabase } from '../../data/supabase';
import { suggestNickname } from '../../data/session';
import * as Auth from '../../lib/auth';
import { NicknameFields, useNicknameCheck } from './NicknameFields';
import s from './Onboarding.module.css';

interface Props { profile: Auth.Profile; onDone(p: Auth.Profile): void }

export function Onboarding({ profile, onDone }: Props) {
  const [name, setName] = useState(profile.display_name ?? profile.email.split('@')[0] ?? '');
  const [nick, setNick] = useState(profile.nickname ?? suggestNickname(profile.email));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = useNicknameCheck(nick, null);

  async function save() {
    setSaving(true);
    setError(null);
    const res = await Auth.setProfile(getSupabase(), name, nick);
    setSaving(false);
    if (res.ok) { onDone({ ...profile, display_name: name.trim() || null, nickname: nick }); return; }
    setError(res.error === 'nickname_taken' ? 'Ник только что заняли, выбери другой' : res.error === 'nickname_format'
      ? 'Только латиница, цифры и _, от 3 до 20' : 'Не получилось сохранить. Проверь сеть и попробуй ещё раз.');
  }

  return (
    <main className={s.screen}>
      <div className={s.glow} aria-hidden="true" />
      <form className={s.body} onSubmit={(e) => { e.preventDefault(); if (status === 'free' && !saving) void save(); }}>
        <Avatar userId={profile.id} name={name || nick || '?'} size={92} />
        <div className={s.copy}>
          <h1 className={s.title}>Как тебя называть?</h1>
          <p className={s.text}>По нику друзья смогут тебя найти. Поменять его можно позже в профиле.</p>
        </div>
        <NicknameFields name={name} nick={nick} status={status} onName={setName} onNick={setNick} />
        {error && <p role="alert" className={s.error}>{error}</p>}
        <div className={s.footer}>
          <Button type="submit" size="lg" className={s.full} disabled={status !== 'free' || saving}>Продолжить</Button>
        </div>
      </form>
    </main>
  );
}
