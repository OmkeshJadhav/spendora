-- 0007_mirror_creates_categories.sql
-- A mirrored group expense brings its category with it.
--
-- 0006 gave each mirror the payer's personal category of the same name, and
-- left it uncategorised when the payer had none. That hid where the money went:
-- a payer with no "Food" category saw their share of the group's dinners under
-- "Uncategorised" on their dashboard.
--
-- Now the payer's category is created when it is missing — a personal category
-- with the group category's name, owned by the payer and editable by them like
-- any other. When the matching category exists but is archived, it is restored,
-- which is what choosing an archived category on the personal expense form does
-- too (`resolveCategoryId` in `src/lib/expenses/actions.ts`).
--
-- A group expense with no category still mirrors as uncategorised.
--
-- Replaces `mirror_group_expense()` from 0006, so apply this after it. The
-- backfill at the end brings existing mirrors up to date.
--
-- Re-runnable: applying this file twice is safe.

create or replace function public.mirror_group_expense(p_expense public.expenses)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group_category_name text;
  v_category_id uuid;
  v_is_archived boolean;
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

  select btrim(g.name)
  into v_group_category_name
  from public.categories g
  where g.id = p_expense.category_id;

  if v_group_category_name is not null then
    -- Names are unique per owner on `lower(btrim(name))`, so at most one.
    select c.id, c.is_archived
    into v_category_id, v_is_archived
    from public.categories c
    where c.user_id = p_expense.paid_by
      and lower(btrim(c.name)) = lower(v_group_category_name);

    if v_category_id is null then
      -- DO NOTHING rather than failing: a concurrent write may create the same
      -- name first, in which case theirs is the one to use.
      insert into public.categories (user_id, name)
      values (p_expense.paid_by, v_group_category_name)
      on conflict (user_id, lower(btrim(name))) where user_id is not null
      do nothing
      returning id into v_category_id;

      if v_category_id is null then
        select c.id
        into v_category_id
        from public.categories c
        where c.user_id = p_expense.paid_by
          and lower(btrim(c.name)) = lower(v_group_category_name);
      end if;
    elsif v_is_archived then
      -- An archived category may not be newly put on an expense
      -- (`expenses_check_category_active`), so it comes back into use.
      update public.categories
      set is_archived = false
      where id = v_category_id;
    end if;
  end if;

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

-- ---------------------------------------------------------------------------
-- Backfill
--
-- Mirrors written by 0006 without a category get one now, creating the
-- payer's category where it is missing.
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
