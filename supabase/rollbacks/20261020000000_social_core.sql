-- Undo 20261020000000_social_core. The pg_cron extension itself stays: other
-- jobs may use it, and it is harmless without ours.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'bl-activity-retention';
  end if;
end $$;
drop function if exists public.display_name_of(public.profiles);
drop function if exists public.visible_titles(uuid);
drop function if exists public.visible_titles_for(uuid, uuid);
drop function if exists public.title_key(text, text, text);
drop function if exists public.are_friends(uuid, uuid);
drop table if exists public.activity_events;
drop table if exists public.invite_links;
drop table if exists public.friend_requests;
drop table if exists public.friendships;
