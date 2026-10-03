import { notFound } from "next/navigation";

import { ExpenseForm } from "@/components/expenses/expense-form";
import { requireProfile, requireUser } from "@/lib/auth/dal";
import { DEFAULT_CURRENCY_CODE } from "@/lib/constants";
import { todayIso } from "@/lib/dates";
import { createExpense } from "@/lib/expenses/actions";
import { createGroupExpense } from "@/lib/expenses/group-actions";
import { listGroupCategories } from "@/lib/expenses/group-queries";
import { listPersonalCategories } from "@/lib/expenses/queries";
import { getGroupDetail } from "@/lib/groups/queries";

/**
 * The "add expenses" forms with their data, rendered both on the full
 * `/…/expenses/new` pages and in the modal that intercepts them.
 *
 * Server Components, so each Server Action is bound here: a Server Action
 * bound inside a Client Component never returns.
 */

export async function PersonalExpenseEntry() {
  const profile = await requireProfile();
  const categories = await listPersonalCategories();

  return (
    <ExpenseForm
      action={createExpense}
      categories={categories.filter((category) => !category.is_archived)}
      payerName={profile.name}
      currencyCode={DEFAULT_CURRENCY_CODE}
      serverToday={todayIso()}
      multiple
      submitLabel="Save expense"
      cancelHref="/expenses"
    />
  );
}

export async function GroupExpenseEntry({ groupId }: { groupId: string }) {
  const user = await requireUser();
  const profile = await requireProfile();
  // Memoised per request, so the page that also reads it pays once.
  const detail = await getGroupDetail(groupId);

  if (!detail) {
    notFound();
  }

  const { group, isAdmin, members } = detail;
  const categories = await listGroupCategories(group.id);

  return (
    <ExpenseForm
      action={createGroupExpense.bind(null, group.id)}
      categories={categories.filter((category) => !category.is_archived)}
      payerName={profile.name}
      members={members.map((member) => ({
        id: member.user_id,
        name: member.profile?.name ?? "Former member",
        isSelf: member.isSelf,
      }))}
      canCreateCategories={isAdmin}
      currencyCode={group.currency_code}
      serverToday={todayIso()}
      defaults={{ paidBy: user.id }}
      multiple
      submitLabel="Save expense"
      cancelHref={`/groups/${group.id}/expenses`}
    />
  );
}
