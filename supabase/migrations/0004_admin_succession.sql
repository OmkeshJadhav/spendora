-- 0004_admin_succession.sql
-- What happens to a group when its last admin's *account* is deleted.
--
-- 0002 established that a group must always keep an admin: the last one cannot
-- be demoted or removed, and is told to appoint someone else or delete the
-- group. That is right for every action a person takes.
--
-- It is wrong for one they do not: deleting an account cascades
-- `auth.users` → `profiles` → `group_members`, and the guard fired on that
-- cascade too — so an account that was the sole admin of any surviving group
-- simply could not be deleted. Postgres reported it as
-- "Database error deleting user", with nothing to act on.
--
-- The cascade is distinguishable from a person's own action: by the time the
-- `group_members` row is removed, the `profiles` row it pointed at is already
-- gone. In that case the group is handed on rather than defended:
--
--   * another member remains  → the longest-standing one becomes admin,
--   * nobody remains          → the group is deleted.
--
-- The second half matters more than it looks. `group_is_unclaimed()` opens a
-- member-less group to every authenticated user — it exists so a creator can
-- read back the group they just inserted, in the instant before the trigger
-- makes them its admin. A group left with zero members would sit in that state
-- permanently and be world-readable. Deleting it closes that off.
--
-- Re-runnable: applying this file twice is safe.

create or replace function public.enforce_group_has_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group_id uuid := old.group_id;
  v_remaining int;
  v_successor uuid;
begin
  if old.role <> 'admin' then
    return coalesce(new, old);
  end if;

  -- The group itself is going away; nothing to protect.
  if not exists (select 1 from public.groups g where g.id = v_group_id) then
    return coalesce(new, old);
  end if;

  select count(*) into v_remaining
  from public.group_members gm
  where gm.group_id = v_group_id
    and gm.role = 'admin'
    and gm.id <> old.id;

  if v_remaining > 0 then
    return coalesce(new, old);
  end if;

  -- The member's account is being deleted: `profiles` cascaded first, so the
  -- row this membership pointed at is already gone. Nobody chose this, so
  -- refusing it would only strand the account.
  if tg_op = 'DELETE'
     and not exists (select 1 from public.profiles p where p.id = old.user_id)
  then
    select gm.id into v_successor
    from public.group_members gm
    where gm.group_id = v_group_id
      and gm.id <> old.id
    order by gm.joined_at, gm.created_at, gm.id
    limit 1;

    if v_successor is null then
      -- No members left. A group nobody belongs to has no owner and no
      -- readers — and would be readable by everyone, through
      -- `group_is_unclaimed()`. Delete it.
      delete from public.groups g where g.id = v_group_id;
    else
      update public.group_members gm
      set role = 'admin'
      where gm.id = v_successor;
    end if;

    return old;
  end if;

  if tg_op = 'DELETE' or new.role <> 'admin' then
    raise exception 'A group must keep at least one admin'
      using errcode = 'check_violation';
  end if;

  return coalesce(new, old);
end;
$$;

create or replace trigger group_members_keep_an_admin
  after update or delete on public.group_members
  for each row execute function public.enforce_group_has_admin();

comment on function public.enforce_group_has_admin() is
  'A group keeps an admin. When the last one deletes their account, the longest-standing member succeeds them; if there is nobody, the group goes too.';
