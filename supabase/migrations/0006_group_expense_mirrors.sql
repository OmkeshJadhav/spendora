-- 0006_group_expense_mirrors.sql
-- A group expense also counts as personal spending for whoever paid it.
--
-- Until now the two were kept strictly apart: a group expense lived only in
-- the group, so somebody who paid ₹2,000 for the group's dinner saw nothing of
-- it in their own expenses, dashboard or budgets — although it was their money
-- that left their account.
--
-- Each group expense now has a *mirror*: an ordinary personal expense owned by
-- its payer, with `source_expense_id` pointing back at the group row. Because
-- the mirror is a personal row like any other, every personal read — the list,
-- its filters and totals, the dashboard, budgets, export — includes it without
-- learning anything new, and no group view sees it (they read `group_id`).
--
-- The group row stays the single source of truth:
--
--   * inserting or editing a group expense writes its mirror (a trigger),
--   * changing who paid moves the mirror to the new payer,
--   * deleting the group expense deletes the mirror (the foreign key cascades),
--   * the payer cannot edit or delete a mirror directly — they change the group
--     expense, if they are allowed to (`expenses_guard_mirror`).
--
-- Two rules decide what a mirror carries:
--
--   * **Currency.** Personal spending is in INR (`DEFAULT_CURRENCY_CODE` in
--     `src/lib/constants.ts`, and this table's column default). A group
--     expense in another currency is not mirrored: adding $40 to a total of
--     rupees would make every personal figure wrong, and there is no exchange
--     rate to convert with.
--
--   * **Category.** Group and personal categories are separate sets, and a
--     personal row may only use the owner's own (a composite foreign key). The
--     mirror takes the payer's personal category of the same name, if they have
--     one; otherwise it is uncategorised. Nothing is created on their behalf.
--
-- Existing group expenses are mirrored at the end of this file.
--
-- Re-runnable: applying this file twice is safe.

-- ---------------------------------------------------------------------------
-- The link
-- ---------------------------------------------------------------------------

alter table public.expenses
  add column if not exists source_expense_id uuid
    references public.expenses (id) on delete cascade;

comment on column public.expenses.source_expense_id is
  'Set on a personal expense that mirrors a group expense its owner paid. Written only by the database.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'expenses_mirror_is_personal'
      and conrelid = 'public.expenses'::regclass
  ) then
    alter table public.expenses
      add constraint expenses_mirror_is_personal
      check (source_expense_id is null or group_id is null);
  end if;
end;
$$;

-- One mirror per group expense, and the lookup the sync does on every write.
create unique index if not exists expenses_source_expense_idx
  on public.expenses (source_expense_id)
  where source_expense_id is not null;

-- ---------------------------------------------------------------------------
-- Writing a mirror
-- ---------------------------------------------------------------------------

-- Brings one group expense's mirror in line with it: created, updated, moved
-- to a new payer, or removed. Shared by the trigger and the backfill below so
-- the two cannot disagree about what a mirror holds.
--
-- Definer, because the mirror belongs to the payer while the write is made by
-- whoever recorded or edited the group expense — RLS would rightly refuse them
-- a row in somebody else's personal records.
create or replace function public.mirror_group_expense(p_expense public.expenses)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_category_id uuid;
begin
  -- A mirror that no longer matches its source goes: the payer changed, or the
  -- expense is not one that is mirrored.
  delete from public.expenses m
  where m.source_expense_id = p_expense.id
    and (
      m.user_id <> p_expense.paid_by
      or p_expense.group_id is null
      or p_expense.currency_code <> 'INR'
    );

  if p_expense.group_id is null or p_expense.currency_code <> 'INR' then
    return;
  end if;

  -- The payer's category of the same name. Names are unique per owner on
  -- `lower(btrim(name))`, so there is at most one. An archived one is used only
  -- if the mirror already has it: archived categories may stay on old rows but
  -- may not be newly chosen (`expenses_check_category_active`).
  select c.id
  into v_category_id
  from public.categories g
  join public.categories c
    on c.user_id = p_expense.paid_by
   and lower(btrim(c.name)) = lower(btrim(g.name))
  where g.id = p_expense.category_id
    and (
      not c.is_archived
      or c.id = (
        select m.category_id from public.expenses m
        where m.source_expense_id = p_expense.id
      )
    );

  insert into public.expenses (
    user_id, paid_by, source_expense_id, category_id, item_name, amount,
    currency_code, expense_date, payment_mode, notes, created_at
  )
  values (
    p_expense.paid_by, p_expense.paid_by, p_expense.id, v_category_id,
    p_expense.item_name, p_expense.amount, p_expense.currency_code,
    p_expense.expense_date, p_expense.payment_mode, p_expense.notes,
    -- Same-day expenses are ordered by created_at; keep the original's place.
    p_expense.created_at
  )
  on conflict (source_expense_id) where source_expense_id is not null
  do update set
    category_id = excluded.category_id,
    item_name = excluded.item_name,
    amount = excluded.amount,
    expense_date = excluded.expense_date,
    payment_mode = excluded.payment_mode,
    notes = excluded.notes;
end;
$$;

revoke all on function public.mirror_group_expense(public.expenses)
  from public, anon, authenticated;

create or replace function public.expenses_sync_mirror()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.mirror_group_expense(new);
  return null;
end;
$$;

-- AFTER, so the mirror is written from the row as it was actually stored —
-- after the identity pin and every check has had its say. Deletes need no
-- trigger: the foreign key cascades to the mirror.
create or replace trigger expenses_sync_mirror
  after insert or update on public.expenses
  for each row
  when (new.group_id is not null)
  execute function public.expenses_sync_mirror();

-- ---------------------------------------------------------------------------
-- Keeping people's hands off mirrors
--
-- RLS lets the owner of a personal row edit and delete it, and a mirror is a
-- personal row — but an edit there would be overwritten by the next change to
-- the group expense, and a deletion would quietly disagree with the group.
--
-- So requests made as an end user (`authenticated`, `anon`) may not create,
-- change or remove a mirror, nor turn an ordinary expense into one. Everything
-- that legitimately does — the sync above, `categories_detach_expenses()`,
-- the foreign key's cascade, a migration — runs as the table owner, and passes.
-- ---------------------------------------------------------------------------

create or replace function public.expenses_guard_mirror()
returns trigger
language plpgsql
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return coalesce(new, old);
  end if;

  if (tg_op <> 'INSERT' and old.source_expense_id is not null)
     or (tg_op <> 'DELETE' and new.source_expense_id is not null) then
    raise exception 'This expense comes from a group. Change it in the group.'
      using errcode = 'insufficient_privilege';
  end if;

  return coalesce(new, old);
end;
$$;

create or replace trigger expenses_guard_mirror
  before insert or update or delete on public.expenses
  for each row execute function public.expenses_guard_mirror();

-- ---------------------------------------------------------------------------
-- Backfill
--
-- Every group expense recorded before this migration gets its mirror now.
-- Re-running is harmless: an existing mirror is simply brought up to date.
-- ---------------------------------------------------------------------------

do $$
declare
  v_expense public.expenses;
begin
  for v_expense in
    select * from public.expenses where group_id is not null
  loop
    perform public.mirror_group_expense(v_expense);
  end loop;
end;
$$;
