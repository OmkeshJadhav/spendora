-- 0003_invitation_preview.sql
-- Reading an invitation from the link that was emailed.
--
-- Accepting an invitation stays exactly as 0002 left it: pure RLS, no
-- privileged endpoint. What is missing there is the step *before* acceptance —
-- rendering the invitation page for whoever opens the link.
--
-- The RLS policy on `group_invitations` only lets the addressee (or a group
-- admin) read a row. That is the right rule for the table, but it means the
-- three cases that matter most on the invitation page are indistinguishable
-- from each other and from a typo:
--
--   * signed in with a different address than the one invited,
--   * the invitation was revoked or already used,
--   * the invitation has expired.
--
-- All three would render as "invalid link", which is unhelpful and looks like
-- a bug. This function answers them, keyed by the token hash — so the emailed
-- token, and only the emailed token, is the capability that opens it.
--
-- What it deliberately does NOT do:
--
--   * It does not grant membership, or any write at all — it is `stable`.
--   * It does not return the group id, so holding a link tells you nothing you
--     could use against the group's other tables.
--   * It does not return the invited address in the clear. A leaked link would
--     otherwise disclose someone's email; the masked form is enough for the
--     invitee to recognise which of their addresses to sign in with.
--
-- Re-runnable: applying this file twice is safe.

-- ---------------------------------------------------------------------------
-- mask_email
-- ---------------------------------------------------------------------------

create or replace function public.mask_email(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_email is null or position('@' in p_email) < 2 then null
    else left(split_part(p_email, '@', 1), 1) || '•••@' || split_part(p_email, '@', 2)
  end;
$$;

comment on function public.mask_email(text) is
  'r•••@example.com — enough to recognise an address, not enough to disclose one.';

-- ---------------------------------------------------------------------------
-- invitation_preview
-- ---------------------------------------------------------------------------

create or replace function public.invitation_preview(p_token_hash text)
returns table (
  group_name text,
  currency_code text,
  inviter_name text,
  invitee_email_masked text,
  invited_role text,
  invitation_status text,
  expires_at timestamptz,
  is_for_current_user boolean,
  is_already_member boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    g.name,
    g.currency_code,
    -- The inviter's account may since have been deleted (`on delete set null`).
    coalesce(p.name, 'A Spendora member'),
    public.mask_email(gi.email),
    gi.role,
    gi.status,
    gi.expires_at,
    gi.email = public.current_user_email(),
    exists (
      select 1
      from public.group_members gm
      where gm.group_id = gi.group_id
        and gm.user_id = (select auth.uid())
    )
  from public.group_invitations gi
  join public.groups g on g.id = gi.group_id
  left join public.profiles p on p.id = gi.invited_by
  -- Shape-checked so a malformed argument can never become a sequential scan
  -- with a user-supplied pattern.
  where p_token_hash ~ '^[0-9a-f]{64}$'
    and gi.token_hash = p_token_hash;
$$;

comment on function public.invitation_preview(text) is
  'What an invitation link may show its holder. Read-only; never returns the group id or the address in the clear.';

revoke all on function public.mask_email(text) from public, anon;
revoke all on function public.invitation_preview(text) from public, anon;

-- Signed-in only: the invitation page requires a session before it renders,
-- because accepting requires one anyway.
grant execute on function public.invitation_preview(text) to authenticated;
