import { useEffect, useState } from 'react';
import { Sheet } from '../../ui/Sheet';
import { Button } from '../../ui/Button';
import { getSupabase } from '../../data/supabase';
import * as Auth from '../../lib/auth';
import { NicknameFields, useNicknameCheck } from '../Onboarding/NicknameFields';
import s from './Profile.module.css';

interface Props { open: boolean; onClose(): void; profile: Auth.Profile; onSaved(p: Auth.Profile): void }

export function EditProfileSheet({ open, onClose, profile, onSaved }: Props) {
  const [name, setName] = useState(profile.display_name ?? '');
  const [nick, setNick] = useState(profile.nickname ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Keeping one's own nickname is not "taken".
  const status = useNicknameCheck(nick, profile.nickname);

  useEffect(() => {
    if (open) { setName(profile.display_name ?? ''); setNick(profile.nickname ?? ''); setError(null); }
  }, [open, profile]);

  async function save() {
    setSaving(true);
    setError(null);
    const res = await Auth.setProfile(getSupabase(), name, nick);
    setSaving(false);
    if (!res.ok) {
      setError(res.error === 'nickname_taken' ? 'Ник только что заняли, выбери другой' : 'Не получилось сохранить. Проверь сеть и попробуй ещё раз.');
      return;
    }
    onSaved({ ...profile, display_name: name.trim() || null, nickname: nick });
    onClose();
  }

  return (
    <Sheet open={open} onClose={onClose} labelledBy="edit-profile-title" footer={
      <Button className={s.full} disabled={status !== 'free' || saving} onClick={() => void save()}>Сохранить</Button>
    }>
      <h2 id="edit-profile-title" className={s.sheetTitle}>Профиль</h2>
      <form className={s.form} onSubmit={(e) => { e.preventDefault(); if (status === 'free' && !saving) void save(); }}>
        <NicknameFields name={name} nick={nick} status={status} onName={setName} onNick={setNick} />
        {error && <p role="alert" className={s.error}>{error}</p>}
      </form>
    </Sheet>
  );
}
