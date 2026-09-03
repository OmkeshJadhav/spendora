import type { Metadata } from "next";

import { CategoryBudgets } from "@/components/categories/category-budgets";
import { FadeIn } from "@/components/ui/fade-in";
import { requireUser } from "@/lib/auth/dal";
import { getBudgetOverview } from "@/lib/budgets/queries";
import type { CategoryOwner } from "@/lib/categories/owner";
import { DEFAULT_CURRENCY_CODE } from "@/lib/constants";
import { formatMonthLabel, resolveMonth } from "@/lib/dates";

export const metadata: Metadata = {
  title: "Categories & budgets",
};

export default async function CategoriesPage(props: PageProps<"/categories">) {
  const user = await requireUser();
  const searchParams = await props.searchParams;

  const month = resolveMonth(
    Array.isArray(searchParams.month) ? searchParams.month[0] : searchParams.month,
  );

  const owner: CategoryOwner = { kind: "personal", userId: user.id };
  const overview = await getBudgetOverview(owner, month);

  return (
    <FadeIn className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Categories &amp; budgets
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your personal categories, and how {formatMonthLabel(month)} is going
          against their monthly budgets.
        </p>
      </div>

      <CategoryBudgets
        owner={owner}
        overview={overview}
        currencyCode={DEFAULT_CURRENCY_CODE}
        canManage
        manageHint="These are private to you."
      />
    </FadeIn>
  );
}
