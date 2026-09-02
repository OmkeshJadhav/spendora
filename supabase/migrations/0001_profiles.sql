-- 0001_profiles.sql
-- Profile foundation: one public profile row per authenticated user.
--
-- Auth itself lives in Supabase's `auth.users`. This table holds the
-- application-facing profile so names can be displayed ("Paid by: Omkesh")
-- without exposing the auth schema, and so more profile fields can be added
-- later without touching authentication.

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

-- Keeps `updated_at` honest; reused by later tables.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null,
  email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_name_length check (char_length(btrim(name)) between 1 and 80),
  constraint profiles_email_format check (position('@' in email) > 1)
);

comment on table public.profiles is
  'Application profile for each auth user. Created automatically on sign up.';

-- auth.users emails are unique, so profiles must not diverge.
create unique index if not exists profiles_email_lower_idx
  on public.profiles (lower(email));

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create or replace trigger profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();

-- Only `name` is user-editable. Identity columns are pinned server-side so a
-- crafted update cannot rewrite them even with a valid session.
create or replace function public.profiles_pin_identity_columns()
returns trigger
language plpgsql
as $$
begin
  new.id = old.id;
  new.email = old.email;
  new.created_at = old.created_at;
  return new;
end;
$$;

create or replace trigger profiles_pin_identity
  before update on public.profiles
  for each row
  execute function public.profiles_pin_identity_columns();

-- Create the profile as part of sign up. Runs as definer because the new user
-- has no session yet; `search_path` is pinned to block search-path hijacking.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, name, email)
  values (
    new.id,
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
      split_part(new.email, '@', 1)
    ),
    new.email
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- Keep the profile email in step when the auth email changes.
create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
  set email = new.email
  where id = new.id;

  return new;
end;
$$;

create or replace trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row
  when (new.email is distinct from old.email)
  execute function public.handle_user_email_change();

-- Anyone who signed up before this migration existed has no profile, and the
-- application would treat them as broken. Backfill them on the same terms the
-- trigger uses. Runs on every apply and is a no-op once everyone has one.
insert into public.profiles (id, name, email)
select
  u.id,
  coalesce(
    nullif(btrim(u.raw_user_meta_data ->> 'name'), ''),
    split_part(u.email, '@', 1)
  ),
  u.email
from auth.users u
where u.email is not null
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;

-- A user can read and rename only their own profile. There is deliberately no
-- insert policy (the sign-up trigger owns creation) and no delete policy
-- (profiles are removed by the cascade from auth.users).
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles
  for select
  to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

revoke all on public.profiles from anon;
grant select, update on public.profiles to authenticated;
