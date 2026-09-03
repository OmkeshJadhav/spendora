import type { CategoryTotal } from "@/lib/expenses/queries";
import { formatMinorUnits } from "@/lib/money";
import type { CurrencyCode } from "@/types";

/**
 * Category spending for a month (specification section 17).
 *
 * The bar is a proportion, not a colour code, and every row states its share
 * in words as well — nothing here depends on seeing colour. A donut chart
 * arrives with the rest of the dashboard visualisations in Phase 8.
 */
export function CategoryBreakdown({
  categories,
  currencyCode,
}: {
  categories: CategoryTotal[];
  currencyCode: CurrencyCode;
}) {
  return (
    <ul className="flex flex-col gap-4">
      {categories.map((category) => (
        <li key={category.id ?? "uncategorised"}>
          <div className="flex items-baseline justify-between gap-4">
            <span className="truncate text-sm font-medium">{category.name}</span>
            <span className="tabular shrink-0 text-sm">
              {formatMinorUnits(category.total, currencyCode)}
              <span className="ml-2 text-xs text-muted-foreground">
                {category.share}%
              </span>
            </span>
          </div>

          <div
            className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted"
            role="img"
            aria-label={`${category.name}: ${category.share}% of this month's spending`}
          >
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${Math.max(category.share, 2)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
