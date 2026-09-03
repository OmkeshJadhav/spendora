-- 0005_in_app_invitations.sql
-- Invitations that live inside the application.
--
-- 0002 and 0003 built invitations around an emailed link: the token is the
-- capability, and `invitation_preview()` renders the page it lands on. That is
-- still the only way to reach somebody who has no account yet.
--
-- For everyone who *does* have an account it is a detour. Invitations are
-- addressed by email, and `group_invitations_select_admin_or_invitee` already
-- lets a signed-in user read the ones addressed to them — so the invitation can
-- simply appear in the application, and be accepted there, with no link, no
-- inbox and no mail provider in the path at all.
--
-- Three things were missing for that, and this migration adds them:
--
--   1. **Somewhere to read them from.** The invitee can read the invitation row,
--      but not the group it points at — `groups` requires membership, which is
--      exactly the rule that stops an invitation leaking a group's contents.
--      `my_pending_invitations()` returns the little that an invitee needs to
--      decide: group name, currency, who invited them, the role, the expiry.
--
--   2. **A way to say no.** Only admins could update an invitation, so an
--      invitee could ignore one but never decline it. `declined` joins the
--      status vocabulary, and one narrow policy lets the addressee set it —
--      and nothing else.
--
--   3. **A guarantee that "and nothing else" holds.** RLS `WITH CHECK` cannot
--      see the old row, so it cannot say "role must not change". The pinning
--      trigger can, and now does: on any update by someone who is not an admin
--      of the group, `role` and `expires_at` are reset to their old values.
--      A declining invitee therefore cannot quietly promote themselves or
--      extend their own deadline on the way out.
--
-- Re-runnable: applying this file twice is safe.

-- ---------------------------------------------------------------------------
-- `declined` becomes a status an invitation can reach
-- ---------------------------------------------------------------------------

alter table public.group_invitations
  drop constraint if exists group_invitations_status_valid;

alter table public.group_invitations
  add constraint group_invitations_status_valid
  check (status in ('pending', 'accepted', 'declined', 'revoked', 'expired'));

-- A declined invitation is no longer pending, so it releases the
-- "one pending invitation per email per group" index and the admin may invite
-- that person again.

-- ---------------------------------------------------------------------------
-- Identity pinning, extended
-- ---------------------------------------------------------------------------

create or replace function public.group_invitations_pin_identity_columns()
returns trigger language plpgsql as $$
begin
  new.id = old.id;
  new.group_id = old.group_id;
  new.email = old.email;
  new.token_hash = old.token_hash;
  new.invited_by = old.invited_by;
  new.created_at = old.created_at;

  -- Only an admin of the group may change what an invitation grants or how
  -- long it lasts. The invitee's one permitted update is `status = 'declined'`,
  -- and this is what keeps it to exactly that.
  if not public.is_group_admin(new.group_id) then
    new.role = old.role;
    new.expires_at = old.expires_at;
  end if;

  return new;
end;
$$;

create or replace trigger group_invitations_pin_identity
  before update on public.group_invitations
  for each row execute function public.group_invitations_pin_identity_columns();

-- ---------------------------------------------------------------------------
-- Declining
-- ---------------------------------------------------------------------------

drop policy if exists "group_invitations_decline_invitee" on public.group_invitations;
create policy "group_invitations_decline_invitee"
  on public.group_invitations
  for update
  to authenticated
  -- Only your own invitation, and only while it is still open.
  using (
    status = 'pending'
    and email = public.current_user_email()
  )
  -- Declining is the only outcome this policy permits.
  with check (
    status = 'declined'
    and email = public.current_user_email()
  );

-- ---------------------------------------------------------------------------
-- The invitee's inbox
-- ---------------------------------------------------------------------------

create or replace function public.my_pending_invitations()
returns table (
  invitation_id uuid,
  group_name text,
  currency_code text,
  inviter_name text,
  invited_role text,
  expires_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    gi.id,
    g.name,
    g.currency_code,
    -- The inviter's account may since have been deleted (`on delete set null`).
    coalesce(p.name, 'A Spendora member'),
    gi.role,
    gi.expires_at,
    gi.created_at
  from public.group_invitations gi
  join public.groups g on g.id = gi.group_id
  left join public.profiles p on p.id = gi.invited_by
  where gi.status = 'pending'
    and gi.expires_at > now()
    and gi.email = public.current_user_email()
    -- Somebody already in the group has nothing left to accept.
    and not exists (
      select 1
      from public.group_members gm
      where gm.group_id = gi.group_id
        and gm.user_id = (select auth.uid())
    )
  order by gi.created_at desc;
$$;

comment on function public.my_pending_invitations() is
  'Open invitations addressed to the signed-in user. Returns no group id — accepting reads the invitation row itself, under RLS.';

revoke all on function public.my_pending_invitations() from public, anon;
grant execute on function public.my_pending_invitations() to authenticated;
