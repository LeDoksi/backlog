-- Signed-out visitors cannot call any v2 RPC; trigger functions are not RPCs.
begin;
select plan(78);
select ok(not has_function_privilege('anon', f, 'execute'), f || ' is closed to anon')
from unnest(array[
  'public.complete_signup(text)', 'public.nickname_available(text)', 'public.set_profile(text,text)',
  'public.set_theme(text)', 'public.my_profile()', 'public.my_boards()', 'public.invite_email(text)',
  'public.find_user_by_nick(text)', 'public.invite_to_shared_board(uuid)', 'public.my_board_invites()',
  'public.respond_board_invite(bigint,boolean)', 'public.leave_shared_board()', 'public.remove_board_member(uuid)',
  'public.copy_title(text,uuid,uuid)', 'public.is_member(uuid)']) f;
select ok(has_function_privilege('authenticated', 'public.complete_signup(text)', 'execute'), 'signed-in users can complete sign-up');
select ok(not has_function_privilege('authenticated', 'public.enforce_board_limits()', 'execute'), 'trigger function is not callable');
select ok(not has_function_privilege('authenticated', 'public.titles_touch()', 'execute'), 'titles_touch is not callable');
-- Phase D: every social RPC is for signed-in people only; helpers are for
-- no caller at all (are_friends would let anyone probe who knows whom).
select ok(not has_function_privilege('anon', f, 'execute'), f || ' is closed to anon')
from unnest(array['public.create_invite_link()', 'public.redeem_invite(text)', 'public.search_users(text)', 'public.send_friend_request(uuid)', 'public.respond_friend_request(bigint,boolean)', 'public.remove_friend(uuid)', 'public.my_inbox()', 'public.my_friends()', 'public.set_board_visibility(uuid,text)', 'public.set_privacy(boolean,boolean,boolean,boolean)', 'public.my_hidden_titles()', 'public.feed(timestamptz,integer,text)', 'public.mark_feed_seen()', 'public.badge_count()', 'public.friend_profile(uuid)', 'public.friend_shelf(uuid,text)', 'public.taste_match(uuid)', 'public.matches()', 'public.friends_on_titles(text[])', 'public.leaderboard(text,text)', 'public.set_board_leaderboard(uuid,boolean)', 'public.copy_from_friend(uuid,text,uuid)']) f;
select ok(has_function_privilege('authenticated', f, 'execute'), f || ' is open to signed-in users')
from unnest(array['public.create_invite_link()', 'public.redeem_invite(text)', 'public.search_users(text)', 'public.send_friend_request(uuid)', 'public.respond_friend_request(bigint,boolean)', 'public.remove_friend(uuid)', 'public.my_inbox()', 'public.my_friends()', 'public.set_board_visibility(uuid,text)', 'public.set_privacy(boolean,boolean,boolean,boolean)', 'public.my_hidden_titles()', 'public.feed(timestamptz,integer,text)', 'public.mark_feed_seen()', 'public.badge_count()', 'public.friend_profile(uuid)', 'public.friend_shelf(uuid,text)', 'public.taste_match(uuid)', 'public.matches()', 'public.friends_on_titles(text[])', 'public.leaderboard(text,text)', 'public.set_board_leaderboard(uuid,boolean)', 'public.copy_from_friend(uuid,text,uuid)']) f;
select ok(not has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute'), f || ' is a helper, not an RPC')
from unnest(array['public.are_friends(uuid,uuid)', 'public.visible_titles_for(uuid,uuid)', 'public.visible_titles(uuid)', 'public.display_name_of(public.profiles)', 'public.request_friendship(uuid,uuid)', 'public.my_friend_ids()', 'public.titles_activity()', 'public.is_app_user(uuid)', 'public.on_common_board(uuid,uuid,uuid)', 'public.safe_timestamptz(text)', 'public.shared_board_leaderboard_reset()', 'public.my_boards_before_leaderboard()', 'public.safe_tz(text)']) f;
-- Social tables are reached only through the functions above: nothing to read or write directly
-- beyond one's own friendships and requests.
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename in ('invite_links', 'activity_events', 'invite_redemptions')), 0, 'no direct access to invite links and events');
select ok(not has_table_privilege('authenticated', 'public.invite_redemptions', 'select'), 'who followed a link is not readable');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename in ('friendships', 'friend_requests') and cmd <> 'SELECT'), 0, 'friendships and requests change only through RPCs');
select * from finish();
rollback;
