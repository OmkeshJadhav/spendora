-- 0002_core_schema.sql
-- Groups, membership, invitations, categories, budgets and expenses.
--
-- Design notes worth knowing before reading the SQL:
--
--  * "Personal" and "group" are the same tables with a different owner column.
--    A personal row has `group_id is null` and `user_id = <owner>`; a group row
--    has `group_id = <group>` and `user_id is null` (categories, budgets) or
--    `user_id = <recorder>` (expenses). Exactly-one-owner is a check constraint,
--    never a convention.
--
--  * Cross-table integrity is declarative wherever Postgres allows it. Because a
--    composite foreign key with a NULL column is not enforced (MATCH SIMPLE),
--    a pair of composite FKs gives "the category must belong to the same owner"
--    for free: the personal FK is skipped for group rows and vice versa.
--
--  * RLS reads membership through `security definer` helpers. A policy on
--    `group_members` that queried `group_members` directly would recurse.
--
--  * Every table pins its identity columns in a before-update trigger, so a
--    crafted UPDATE cannot move a row to another owner even where the policy's
--    WITH CHECK would accept the result.
--
-- Re-runnable: applying this file twice is safe.

-- ---------------------------------------------------------------------------
-- groups
-- ---------------------------------------------------------------------------

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  currency_code text not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint groups_name_length check (char_length(btrim(name)) between 1 and 80),
  constraint groups_description_length check (description is null or char_length(description) <= 500),
  constraint groups_currency_code_valid check (currency_code in ('INR', 'USD', 'EUR', 'GBP'))
);

comment on table public.groups is
  'A shared expense space. Currency is fixed per group (specification section 10).';

-- Lets expenses carry a composite FK on (group_id, currency_code), which is how
-- "a group expense must use the group currency" is enforced without a trigger.
create unique index if not exists groups_id_currency_idx
  on public.groups (id, currency_code);

create index if not exists groups_created_by_idx
  on public.groups (created_by);

-- ---------------------------------------------------------------------------
-- group_members
-- ---------------------------------------------------------------------------

create table if not exists public.group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member',
  joined_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint group_members_role_valid check (role in ('admin', 'member')),
  -- Specification section 30: a user cannot have duplicate membership.
  constraint group_members_unique_membership unique (group_id, user_id)
);

comment on table public.group_members is
  'Membership and role. The unique constraint is what makes duplicate joins impossible.';

create index if not exists group_members_user_idx
  on public.group_members (user_id);

create index if not exists group_members_group_role_idx
  on public.group_members (group_id, role);

-- ---------------------------------------------------------------------------
-- group_invitations
-- ---------------------------------------------------------------------------

create table if not exists public.group_invitations (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  email text not null,
  role text not null default 'member',
  -- Only the SHA-256 of the emailed token is stored, so a database leak does
  -- not hand out working invitation links (specification section 32).
  token_hash text not null unique,
  invited_by uuid references public.profiles (id) on delete set null,
  status text not null default 'pending',
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint group_invitations_email_format check (position('@' in email) > 1),
  constraint group_invitations_role_valid check (role in ('admin', 'member')),
  constraint group_invitations_status_valid check (status in ('pending', 'accepted', 'revoked', 'expired')),
  constraint group_invitations_token_hash_format check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint group_invitations_expiry_after_creation check (expires_at > created_at),
  -- `accepted_at` is the durable record of acceptance. `accepted_by` is best
  -- effort: it is nulled if that account is later deleted, so requiring it here
  -- would make deleting a user impossible.
  constraint group_invitations_accepted_fields check (
    (status = 'accepted') = (accepted_at is not null)
  )
);

comment on table public.group_invitations is
  'Pending invitations addressed by email. Tokens are stored hashed, never in the clear.';

-- Specification section 11: prevent duplicate invitations. Only one invitation
-- per email may be outstanding for a group; revoked and accepted ones do not
-- block re-inviting.
create unique index if not exists group_invitations_pending_unique_idx
  on public.group_invitations (group_id, email)
  where status = 'pending';

create index if not exists group_invitations_email_idx
  on public.group_invitations (email) where status = 'pending';

create index if not exists group_invitations_group_idx
  on public.group_invitations (group_id);

-- ---------------------------------------------------------------------------
-- categories
-- ---------------------------------------------------------------------------

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references public.groups (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete cascade,
  name text not null,
  -- Categories in use cannot be deleted (expenses reference them), so
  -- "remove a category I do not need" is archiving.
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint categories_name_length check (char_length(btrim(name)) between 1 and 60),
  constraint categories_single_owner check (num_nonnulls(group_id, user_id) = 1)
);

comment on table public.categories is
  'Either a group category (group_id set) or a personal one (user_id set), never both.';

-- Composite targets so budgets and expenses can prove, declaratively, that a
-- category belongs to the same owner as the row referencing it.
create unique index if not exists categories_id_group_idx
  on public.categories (id, group_id);

create unique index if not exists categories_id_user_idx
  on public.categories (id, user_id);

create unique index if not exists categories_group_name_idx
  on public.categories (group_id, lower(btrim(name)))
  where group_id is not null;

create unique index if not exists categories_user_name_idx
  on public.categories (user_id, lower(btrim(name)))
  where user_id is not null;

-- ---------------------------------------------------------------------------
-- budgets
--
-- `period_month` NULL is the standing monthly budget; a row with a month set
-- overrides it for that month only. Reading a month is therefore
-- coalesce(month-specific, standing), which satisfies "budgets are monthly"
-- today and "support month-specific budgets" later (specification section 15).
-- ---------------------------------------------------------------------------

create table if not exists public.budgets (
  id uuid primary key default gen_random_uuid(),
  group_id uuid,
  user_id uuid,
  category_id uuid not null,
  amount numeric(14, 2) not null,
  period_month date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint budgets_amount_positive check (amount > 0),
  constraint budgets_single_owner check (num_nonnulls(group_id, user_id) = 1),
  constraint budgets_period_is_month_start check (
    period_month is null or period_month = date_trunc('month', period_month)::date
  ),
  constraint budgets_group_fkey
    foreign key (group_id) references public.groups (id) on delete cascade,
  constraint budgets_user_fkey
    foreign key (user_id) references public.profiles (id) on delete cascade,
  -- Enforced only for group budgets; skipped when group_id is NULL.
  constraint budgets_category_in_group_fkey
    foreign key (category_id, group_id) references public.categories (id, group_id)
    on delete cascade,
  -- Enforced only for personal budgets.
  constraint budgets_category_of_user_fkey
    foreign key (category_id, user_id) references public.categories (id, user_id)
    on delete cascade
);

comment on table public.budgets is
  'Monthly budget per category. period_month NULL is the standing budget; a date overrides one month.';

create unique index if not exists budgets_standing_unique_idx
  on public.budgets (category_id)
  where period_month is null;

create unique index if not exists budgets_month_unique_idx
  on public.budgets (category_id, period_month)
  where period_month is not null;

create index if not exists budgets_group_month_idx
  on public.budgets (group_id, period_month) where group_id is not null;

create index if not exists budgets_user_month_idx
  on public.budgets (user_id, period_month) where user_id is not null;

-- ---------------------------------------------------------------------------
-- expenses
-- ---------------------------------------------------------------------------

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  -- Who recorded it. Also the owner for personal expenses.
  user_id uuid not null references public.profiles (id) on delete cascade,
  group_id uuid,
  -- Who actually paid. Equals user_id for personal expenses.
  paid_by uuid not null references public.profiles (id) on delete cascade,
  category_id uuid,
  -- The owner, but only when this is a personal expense. `user_id` cannot play
  -- that role because it is the recorder and is set on group expenses too,
  -- which would make the personal-category foreign key below fire on them.
  personal_owner_id uuid generated always as (
    case when group_id is null then user_id end
  ) stored,
  item_name text not null,
  amount numeric(14, 2) not null,
  currency_code text not null default 'INR',
  -- A calendar date, not a timestamp: "10 Sept 2026" must not shift by timezone.
  expense_date date not null,
  payment_mode text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint expenses_item_name_length check (char_length(btrim(item_name)) between 1 and 120),
  constraint expenses_amount_positive check (amount > 0),
  constraint expenses_currency_code_valid check (currency_code in ('INR', 'USD', 'EUR', 'GBP')),
  constraint expenses_payment_mode_valid check (
    payment_mode is null or payment_mode in (
      'upi', 'credit_card', 'debit_card', 'cash',
      'bank_transfer', 'net_banking', 'wallet', 'other'
    )
  ),
  constraint expenses_notes_length check (notes is null or char_length(notes) <= 500),
  -- A personal expense is always paid by its owner (specification section 45).
  constraint expenses_personal_paid_by_owner check (group_id is not null or paid_by = user_id),
  constraint expenses_group_fkey
    foreign key (group_id) references public.groups (id) on delete cascade,
  -- A group expense must carry the group's currency; skipped when group_id is
  -- NULL. ON UPDATE RESTRICT means a group's currency can be changed freely
  -- until its first expense, and never after — the recorded amounts would
  -- otherwise silently change meaning.
  constraint expenses_group_currency_fkey
    foreign key (group_id, currency_code) references public.groups (id, currency_code)
    on update restrict on delete cascade,
  -- Both are NO ACTION: a foreign key that includes a generated column cannot
  -- carry a referential action. `categories_detach_expenses()` below does the
  -- work instead, clearing category_id before the category row goes.
  constraint expenses_category_in_group_fkey
    foreign key (category_id, group_id) references public.categories (id, group_id),
  constraint expenses_category_of_user_fkey
    foreign key (category_id, personal_owner_id) references public.categories (id, user_id)
);

comment on table public.expenses is
  'Personal (group_id NULL) and group expenses. Amounts are numeric, never float.';

-- Monthly lists are the hot path, and they are always scoped to one owner.
create index if not exists expenses_personal_date_idx
  on public.expenses (user_id, expense_date desc)
  where group_id is null;

create index if not exists expenses_group_date_idx
  on public.expenses (group_id, expense_date desc)
  where group_id is not null;

-- Member-spending breakdown (specification section 21).
create index if not exists expenses_group_paid_by_idx
  on public.expenses (group_id, paid_by) where group_id is not null;

create index if not exists expenses_category_idx
  on public.expenses (category_id) where category_id is not null;

-- ---------------------------------------------------------------------------
-- Integrity triggers
-- ---------------------------------------------------------------------------

-- updated_at, via the helper introduced in 0001.
create or replace trigger groups_set_updated_at
  before update on public.groups
  for each row execute function public.set_updated_at();

create or replace trigger group_members_set_updated_at
  before update on public.group_members
  for each row execute function public.set_updated_at();

create or replace trigger group_invitations_set_updated_at
  before update on public.group_invitations
  for each row execute function public.set_updated_at();

create or replace trigger categories_set_updated_at
  before update on public.categories
  for each row execute function public.set_updated_at();

create or replace trigger budgets_set_updated_at
  before update on public.budgets
  for each row execute function public.set_updated_at();

create or replace trigger expenses_set_updated_at
  before update on public.expenses
  for each row execute function public.set_updated_at();

-- Identity pinning. RLS decides who may update a row; these decide which
-- columns an update may not touch, so a row can never be moved to a different
-- owner, group or creator.

create or replace function public.groups_pin_identity_columns()
returns trigger language plpgsql as $$
begin
  new.id = old.id;
  new.created_by = old.created_by;
  new.created_at = old.created_at;
  return new;
end;
$$;

create or replace trigger groups_pin_identity
  before update on public.groups
  for each row execute function public.groups_pin_identity_columns();

create or replace function public.group_members_pin_identity_columns()
returns trigger language plpgsql as $$
begin
  new.id = old.id;
  new.group_id = old.group_id;
  new.user_id = old.user_id;
  new.joined_at = old.joined_at;
  new.created_at = old.created_at;
  return new;
end;
$$;

create or replace trigger group_members_pin_identity
  before update on public.group_members
  for each row execute function public.group_members_pin_identity_columns();

create or replace function public.group_invitations_pin_identity_columns()
returns trigger language plpgsql as $$
begin
  new.id = old.id;
  new.group_id = old.group_id;
  new.email = old.email;
  new.token_hash = old.token_hash;
  new.invited_by = old.invited_by;
  new.created_at = old.created_at;
  return new;
end;
$$;

create or replace trigger group_invitations_pin_identity
  before update on public.group_invitations
  for each row execute function public.group_invitations_pin_identity_columns();

create or replace function public.categories_pin_identity_columns()
returns trigger language plpgsql as $$
begin
  new.id = old.id;
  new.group_id = old.group_id;
  new.user_id = old.user_id;
  new.created_at = old.created_at;
  return new;
end;
$$;

create or replace trigger categories_pin_identity
  before update on public.categories
  for each row execute function public.categories_pin_identity_columns();

create or replace function public.budgets_pin_identity_columns()
returns trigger language plpgsql as $$
begin
  new.id = old.id;
  new.group_id = old.group_id;
  new.user_id = old.user_id;
  new.created_at = old.created_at;
  return new;
end;
$$;

create or replace trigger budgets_pin_identity
  before update on public.budgets
  for each row execute function public.budgets_pin_identity_columns();

create or replace function public.expenses_pin_identity_columns()
returns trigger language plpgsql as $$
begin
  new.id = old.id;
  new.user_id = old.user_id;
  new.group_id = old.group_id;
  new.created_at = old.created_at;
  return new;
end;
$$;

create or replace trigger expenses_pin_identity
  before update on public.expenses
  for each row execute function public.expenses_pin_identity_columns();

-- The group creator becomes its admin. Definer, because at this instant the
-- creator is not yet a member and so the group_members insert policy would
-- refuse them (specification section 9).
create or replace function public.handle_new_group()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.created_by is not null then
    insert into public.group_members (group_id, user_id, role)
    values (new.id, new.created_by, 'admin')
    on conflict (group_id, user_id) do nothing;
  end if;

  return new;
end;
$$;

create or replace trigger on_group_created
  after insert on public.groups
  for each row execute function public.handle_new_group();

-- A group must never be left without an admin.
create or replace function public.enforce_group_has_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group_id uuid := old.group_id;
  v_remaining int;
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

  if v_remaining = 0 and (tg_op = 'DELETE' or new.role <> 'admin') then
    raise exception 'A group must keep at least one admin'
      using errcode = 'check_violation';
  end if;

  return coalesce(new, old);
end;
$$;

create or replace trigger group_members_keep_an_admin
  after update or delete on public.group_members
  for each row execute function public.enforce_group_has_admin();

-- Normalise the invitation email once, so the "one pending invitation per
-- email" index and the invitee's own lookup both compare like with like.
create or replace function public.normalize_invitation_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.email = lower(btrim(new.email));

  if tg_op = 'INSERT' and exists (
    select 1
    from public.group_members gm
    join public.profiles p on p.id = gm.user_id
    where gm.group_id = new.group_id
      and lower(p.email) = new.email
  ) then
    raise exception 'That person is already a member of this group'
      using errcode = 'unique_violation';
  end if;

  return new;
end;
$$;

create or replace trigger group_invitations_normalize_email
  before insert or update on public.group_invitations
  for each row execute function public.normalize_invitation_email();

-- Joining a group closes the invitation that allowed it. Definer, because the
-- invitee has no update rights on invitations.
create or replace function public.close_invitation_on_join()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.group_invitations gi
  set status = 'accepted',
      accepted_at = now(),
      accepted_by = new.user_id
  where gi.group_id = new.group_id
    and gi.status = 'pending'
    and gi.email = (
      select lower(p.email) from public.profiles p where p.id = new.user_id
    );

  return new;
end;
$$;

create or replace trigger group_members_close_invitation
  after insert on public.group_members
  for each row execute function public.close_invitation_on_join();

-- Specification section 45: whoever is recorded as having paid must be an
-- active member of the group at the time the expense is written. This is a
-- trigger rather than a foreign key on purpose — removing a member later must
-- not delete or block the expenses they already paid for.
create or replace function public.expenses_validate_paid_by()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.group_id is not null and not exists (
    select 1
    from public.group_members gm
    where gm.group_id = new.group_id
      and gm.user_id = new.paid_by
  ) then
    raise exception 'Paid by must be a member of the group'
      using errcode = 'foreign_key_violation';
  end if;

  return new;
end;
$$;

create or replace trigger expenses_check_paid_by
  before insert or update of paid_by, group_id on public.expenses
  for each row execute function public.expenses_validate_paid_by();

-- Deleting a category leaves its expenses in place and merely uncategorised.
-- Doing this before the delete also keeps a group's cascade (which removes both
-- its categories and its expenses) from depending on which order they go in.
create or replace function public.categories_detach_expenses()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.expenses
  set category_id = null
  where category_id = old.id;

  return old;
end;
$$;

create or replace trigger categories_detach_expenses_before_delete
  before delete on public.categories
  for each row execute function public.categories_detach_expenses();

-- Archived categories stay readable for historical expenses but must not be
-- picked for new ones.
create or replace function public.expenses_reject_archived_category()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.category_id is not null
     and (tg_op = 'INSERT' or new.category_id is distinct from old.category_id)
     and exists (
       select 1 from public.categories c
       where c.id = new.category_id and c.is_archived
     ) then
    raise exception 'That category is archived'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create or replace trigger expenses_check_category_active
  before insert or update of category_id on public.expenses
  for each row execute function public.expenses_reject_archived_category();

-- ---------------------------------------------------------------------------
-- Authorization helpers
--
-- Defined after the tables, because a SQL-language function body is validated
-- the moment it is created and these read `group_members`.
--
-- `security definer` so they can read group_members without tripping that
-- table's own policies, `stable` so the planner can cache them within a
-- statement, and `search_path = ''` so every reference must be schema-qualified
-- and cannot be hijacked.
-- ---------------------------------------------------------------------------

create or replace function public.is_group_member(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_members gm
    where gm.group_id = p_group_id
      and gm.user_id = (select auth.uid())
  );
$$;

create or replace function public.is_group_admin(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_members gm
    where gm.group_id = p_group_id
      and gm.user_id = (select auth.uid())
      and gm.role = 'admin'
  );
$$;

-- True when the current user and `p_user_id` are in at least one group
-- together. Used so members can see each other's names ("Paid by: Rahul").
create or replace function public.shares_group_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_members mine
    join public.group_members theirs on theirs.group_id = mine.group_id
    where mine.user_id = (select auth.uid())
      and theirs.user_id = p_user_id
  );
$$;

-- True only while a group has no members at all. The single moment that holds
-- is between the INSERT on `groups` and the AFTER trigger that makes the
-- creator its admin — which is precisely when `INSERT ... RETURNING` (what
-- PostgREST issues for `.insert().select()`) tests the new row against the
-- SELECT policy. Without this the creator could not read back the group they
-- had just created. Scoping it to "no members yet" rather than to `created_by`
-- means a founder who is later removed from the group loses sight of it.
create or replace function public.group_is_unclaimed(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1
    from public.group_members gm
    where gm.group_id = p_group_id
  );
$$;

-- The signed-in user's email, normalised. Invitations are addressed by email,
-- so the invitee has to be able to match themselves against one.
create or replace function public.current_user_email()
returns text
language sql
stable
set search_path = ''
as $$
  select lower(btrim(coalesce(auth.jwt() ->> 'email', '')));
$$;

revoke all on function public.is_group_member(uuid) from public, anon;
revoke all on function public.is_group_admin(uuid) from public, anon;
revoke all on function public.shares_group_with(uuid) from public, anon;
revoke all on function public.group_is_unclaimed(uuid) from public, anon;
revoke all on function public.current_user_email() from public, anon;

grant execute on function public.is_group_member(uuid) to authenticated;
grant execute on function public.is_group_admin(uuid) to authenticated;
grant execute on function public.shares_group_with(uuid) to authenticated;
grant execute on function public.group_is_unclaimed(uuid) to authenticated;
grant execute on function public.current_user_email() to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Everything below is deny-by-default: RLS on, `anon` revoked, and only the
-- listed policies open anything up for `authenticated`.
-- ---------------------------------------------------------------------------

alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.group_invitations enable row level security;
alter table public.categories enable row level security;
alter table public.budgets enable row level security;
alter table public.expenses enable row level security;

-- profiles ------------------------------------------------------------------
-- 0001 limits reads to your own row. Group members also need to see each
-- other's names; this policy is permissive, so it widens the existing one.
-- Trade-off: fellow members of a group can see each other's name and email.

drop policy if exists "profiles_select_group_peers" on public.profiles;
create policy "profiles_select_group_peers"
  on public.profiles
  for select
  to authenticated
  using (public.shares_group_with(id));

-- groups --------------------------------------------------------------------

drop policy if exists "groups_select_member" on public.groups;
create policy "groups_select_member"
  on public.groups
  for select
  to authenticated
  using (
    public.is_group_member(id)
    or (created_by = (select auth.uid()) and public.group_is_unclaimed(id))
  );

drop policy if exists "groups_insert_self" on public.groups;
create policy "groups_insert_self"
  on public.groups
  for insert
  to authenticated
  with check (created_by = (select auth.uid()));

drop policy if exists "groups_update_admin" on public.groups;
create policy "groups_update_admin"
  on public.groups
  for update
  to authenticated
  using (public.is_group_admin(id))
  with check (public.is_group_admin(id));

drop policy if exists "groups_delete_admin" on public.groups;
create policy "groups_delete_admin"
  on public.groups
  for delete
  to authenticated
  using (public.is_group_admin(id));

-- group_members -------------------------------------------------------------

drop policy if exists "group_members_select_member" on public.group_members;
create policy "group_members_select_member"
  on public.group_members
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_group_member(group_id)
  );

-- Admins add members; a user may add themselves only against a pending,
-- unexpired invitation addressed to their own email, and only in the role that
-- invitation grants. This is the whole of "accept an invitation".
drop policy if exists "group_members_insert_admin_or_invitee" on public.group_members;
create policy "group_members_insert_admin_or_invitee"
  on public.group_members
  for insert
  to authenticated
  with check (
    public.is_group_admin(group_id)
    or (
      user_id = (select auth.uid())
      and exists (
        select 1
        from public.group_invitations gi
        where gi.group_id = group_members.group_id
          and gi.status = 'pending'
          and gi.expires_at > now()
          and gi.email = public.current_user_email()
          and gi.role = group_members.role
      )
    )
  );

drop policy if exists "group_members_update_admin" on public.group_members;
create policy "group_members_update_admin"
  on public.group_members
  for update
  to authenticated
  using (public.is_group_admin(group_id))
  with check (public.is_group_admin(group_id));

-- Admins remove members; anyone may remove themselves (leave the group).
drop policy if exists "group_members_delete_admin_or_self" on public.group_members;
create policy "group_members_delete_admin_or_self"
  on public.group_members
  for delete
  to authenticated
  using (
    public.is_group_admin(group_id)
    or user_id = (select auth.uid())
  );

-- group_invitations ---------------------------------------------------------

-- An admin sees what they sent; an invitee sees invitations addressed to them.
-- Neither exposes the group itself: `groups` still requires membership.
drop policy if exists "group_invitations_select_admin_or_invitee" on public.group_invitations;
create policy "group_invitations_select_admin_or_invitee"
  on public.group_invitations
  for select
  to authenticated
  using (
    public.is_group_admin(group_id)
    or email = public.current_user_email()
  );

drop policy if exists "group_invitations_insert_admin" on public.group_invitations;
create policy "group_invitations_insert_admin"
  on public.group_invitations
  for insert
  to authenticated
  with check (
    public.is_group_admin(group_id)
    and invited_by = (select auth.uid())
    and status = 'pending'
  );

drop policy if exists "group_invitations_update_admin" on public.group_invitations;
create policy "group_invitations_update_admin"
  on public.group_invitations
  for update
  to authenticated
  using (public.is_group_admin(group_id))
  with check (public.is_group_admin(group_id));

drop policy if exists "group_invitations_delete_admin" on public.group_invitations;
create policy "group_invitations_delete_admin"
  on public.group_invitations
  for delete
  to authenticated
  using (public.is_group_admin(group_id));

-- categories ----------------------------------------------------------------

drop policy if exists "categories_select_owner_or_member" on public.categories;
create policy "categories_select_owner_or_member"
  on public.categories
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or (group_id is not null and public.is_group_member(group_id))
  );

-- Personal categories belong to their owner; group categories are admin-managed
-- (specification section 14, the simple MVP choice).
drop policy if exists "categories_insert_owner_or_admin" on public.categories;
create policy "categories_insert_owner_or_admin"
  on public.categories
  for insert
  to authenticated
  with check (
    (group_id is null and user_id = (select auth.uid()))
    or (user_id is null and public.is_group_admin(group_id))
  );

drop policy if exists "categories_update_owner_or_admin" on public.categories;
create policy "categories_update_owner_or_admin"
  on public.categories
  for update
  to authenticated
  using (
    user_id = (select auth.uid())
    or (group_id is not null and public.is_group_admin(group_id))
  )
  with check (
    user_id = (select auth.uid())
    or (group_id is not null and public.is_group_admin(group_id))
  );

drop policy if exists "categories_delete_owner_or_admin" on public.categories;
create policy "categories_delete_owner_or_admin"
  on public.categories
  for delete
  to authenticated
  using (
    user_id = (select auth.uid())
    or (group_id is not null and public.is_group_admin(group_id))
  );

-- budgets -------------------------------------------------------------------

drop policy if exists "budgets_select_owner_or_member" on public.budgets;
create policy "budgets_select_owner_or_member"
  on public.budgets
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or (group_id is not null and public.is_group_member(group_id))
  );

-- Members read budgets; only admins set them (specification section 9).
drop policy if exists "budgets_insert_owner_or_admin" on public.budgets;
create policy "budgets_insert_owner_or_admin"
  on public.budgets
  for insert
  to authenticated
  with check (
    (group_id is null and user_id = (select auth.uid()))
    or (user_id is null and public.is_group_admin(group_id))
  );

drop policy if exists "budgets_update_owner_or_admin" on public.budgets;
create policy "budgets_update_owner_or_admin"
  on public.budgets
  for update
  to authenticated
  using (
    user_id = (select auth.uid())
    or (group_id is not null and public.is_group_admin(group_id))
  )
  with check (
    user_id = (select auth.uid())
    or (group_id is not null and public.is_group_admin(group_id))
  );

drop policy if exists "budgets_delete_owner_or_admin" on public.budgets;
create policy "budgets_delete_owner_or_admin"
  on public.budgets
  for delete
  to authenticated
  using (
    user_id = (select auth.uid())
    or (group_id is not null and public.is_group_admin(group_id))
  );

-- expenses ------------------------------------------------------------------

-- Personal expenses are visible to their owner and nobody else; group expenses
-- to every member (specification section 31).
drop policy if exists "expenses_select_owner_or_member" on public.expenses;
create policy "expenses_select_owner_or_member"
  on public.expenses
  for select
  to authenticated
  using (
    (group_id is null and user_id = (select auth.uid()))
    or (group_id is not null and public.is_group_member(group_id))
  );

drop policy if exists "expenses_insert_owner_or_member" on public.expenses;
create policy "expenses_insert_owner_or_member"
  on public.expenses
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and (
      group_id is null
      or public.is_group_member(group_id)
    )
  );

-- You may edit what you recorded; a group admin may edit anything in the group.
drop policy if exists "expenses_update_author_or_admin" on public.expenses;
create policy "expenses_update_author_or_admin"
  on public.expenses
  for update
  to authenticated
  using (
    (group_id is null and user_id = (select auth.uid()))
    or (
      group_id is not null
      and (
        (user_id = (select auth.uid()) and public.is_group_member(group_id))
        or public.is_group_admin(group_id)
      )
    )
  )
  with check (
    (group_id is null and user_id = (select auth.uid()))
    or (
      group_id is not null
      and (
        (user_id = (select auth.uid()) and public.is_group_member(group_id))
        or public.is_group_admin(group_id)
      )
    )
  );

drop policy if exists "expenses_delete_author_or_admin" on public.expenses;
create policy "expenses_delete_author_or_admin"
  on public.expenses
  for delete
  to authenticated
  using (
    (group_id is null and user_id = (select auth.uid()))
    or (
      group_id is not null
      and (
        (user_id = (select auth.uid()) and public.is_group_member(group_id))
        or public.is_group_admin(group_id)
      )
    )
  );

-- ---------------------------------------------------------------------------
-- Grants
--
-- RLS filters rows; grants decide whether the role may touch the table at all.
-- Both are needed: a missing policy with a grant leaks nothing, but a grant to
-- `anon` on a table whose RLS is ever disabled would.
-- ---------------------------------------------------------------------------

revoke all on public.groups from anon;
revoke all on public.group_members from anon;
revoke all on public.group_invitations from anon;
revoke all on public.categories from anon;
revoke all on public.budgets from anon;
revoke all on public.expenses from anon;

grant select, insert, update, delete on public.groups to authenticated;
grant select, insert, update, delete on public.group_members to authenticated;
grant select, insert, update, delete on public.group_invitations to authenticated;
grant select, insert, update, delete on public.categories to authenticated;
grant select, insert, update, delete on public.budgets to authenticated;
grant select, insert, update, delete on public.expenses to authenticated;
