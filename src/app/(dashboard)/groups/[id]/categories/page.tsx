import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CategoryBudgets } from "@/components/categories/category-budgets";
import { GroupContext } from "@/components/groups/group-context";
import { FadeIn } from "@/components/ui/fade-in";
import { requireUser } from "@/lib/auth/dal";
import { getBudgetOverview } from "@/lib/budgets/queries";
import type { CategoryOwner } from "@/lib/categories/owner";
import { resolveMonth } from "@/lib/dates";
import { getGroupDetail } from "@/lib/groups/queries";

export const metadata: Metadata = {
  title: "Group categories & budgets",
};

export default async function GroupCategoriesPage(
  props: PageProps<"/groups/[id]/categories">,
) {
  const { id } = await props.params;
  await requireUser();

  const detail = await getGroupDetail(id);

  // Covers both "no such group" and "not a member of it": RLS returns nothing
  // in either case, and the two should be indistinguishable from outside.
  if (!detail) {
    notFound();
  }

  const searchParams = await props.searchParams;
  const month = resolveMonth(
    Array.isArray(searchParams.month) ? searchParams.month[0] : searchParams.month,
  );

  const { group, role, isAdmin } = detail;
  const owner: CategoryOwner = { kind: "group", groupId: group.id };
  const overview = await getBudgetOverview(owner, month);

  return (
    <FadeIn className="flex flex-col gap-6">
      <GroupContext
        groupId={group.id}
        name={group.name}
        description={null}
        currencyCode={group.currency_code}
        role={role}
        backHref={`/groups/${group.id}`}
        backLabel="Back to group"
        showSettings={isAdmin}
      />

      <CategoryBudgets
        owner={owner}
        overview={overview}
        currencyCode={group.currency_code}
        // Members read budgets; admins set them (specification section 9). The
        // page hides controls it knows would be refused — the refusal itself
        // is the database's, in `categories_*` and `budgets_*`.
        canManage={isAdmin}
        manageHint={
          isAdmin
            ? "Every member sees these when adding an expense."
            : "Only a group admin can change these."
        }
      />
    </FadeIn>
  );
}
