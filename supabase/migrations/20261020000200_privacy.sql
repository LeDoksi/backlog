-- Privacy controls: who sees each board, and the four participation
-- switches. Hiding a single title is an ordinary titles update (members may
-- write their boards), so it needs no function; listing hidden titles
-- across both boards does.
create or replace function public.set_board_visibility(p_workspace uuid, p_visibility text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_member(p_workspace) then raise exception 'not_member' using errcode = 'P0001'; end if;
  if p_visibility not in ('private', 'friends', 'everyone') then raise exception 'bad_visibility' using errcode = 'P0001'; end if;
  update workspaces set visibility = p_visibility where id = p_workspace;
end $$;

create or replace function public.set_privacy(p_in_leaderboard boolean, p_share_activity boolean, p_share_matches boolean, p_findable_by_nick boolean) returns void
language sql security definer set search_path = public as $$
  update profiles set in_leaderboard = p_in_leaderboard, share_activity = p_share_activity,
    share_matches = p_share_matches, findable_by_nick = p_findable_by_nick
  where id = auth.uid();
$$;

create or replace function public.my_hidden_titles()
returns table (workspace_id uuid, id text, title text, category text, year int, cover text)
language sql stable security definer set search_path = public as $$
  select t.workspace_id, t.id, t.title, t.category, t.year, t.cover
  from titles t join workspace_members m on m.workspace_id = t.workspace_id and m.user_id = auth.uid()
  where t.hidden
  order by t.updated_at desc;
$$;

do $$
declare f text;
begin
  foreach f in array array['public.set_board_visibility(uuid,text)', 'public.set_privacy(boolean,boolean,boolean,boolean)', 'public.my_hidden_titles()'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
