import { Filter, X } from "lucide-react";
import Link from "next/link";

import { Button, buttonVariants } from "@/components/ui/button";
import { Field, fieldAria } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { PAYMENT_MODES } from "@/lib/constants";
import type { ExpenseCategory } from "@/lib/expenses/queries";
import {
  FILTER_UNCATEGORISED,
  hasActiveFilters,
  type ExpenseFilters,
} from "@/lib/expenses/filters";

/**
 * Filters for a group's expense list (specification section 24).
 *
 * A plain GET form: the filters end up in the query string, so the view is
 * linkable, survives a refresh and works with JavaScript turned off. Clearing
 * them is a link back to the unfiltered list rather than a reset button,
 * for the same reason.
 *
 * Search by text and date ranges are Phase 9; this covers the three fields a
 * group list is usually narrowed by.
 */
export function ExpenseFilterBar({
  basePath,
  filters,
  categories,
  members,
}: {
  basePath: string;
  filters: ExpenseFilters;
  categories: ExpenseCategory[];
  members: { id: string; name: string; isSelf: boolean }[];
}) {
  const active = hasActiveFilters(filters);

  return (
    <form
      action={basePath}
      method="get"
      className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4"
      aria-label="Filter expenses"
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Field name="category" label="Category">
          <Select
            name="category"
            defaultValue={filters.categoryId ?? ""}
            {...fieldAria("category")}
          >
            <option value="">All categories</option>
            <option value={FILTER_UNCATEGORISED}>Uncategorised</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field name="paidBy" label="Paid by">
          <Select
            name="paidBy"
            defaultValue={filters.paidBy ?? ""}
            {...fieldAria("paidBy")}
          >
            <option value="">Anyone</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.isSelf ? `${member.name} (you)` : member.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field name="paymentMode" label="Payment mode">
          <Select
            name="paymentMode"
            defaultValue={filters.paymentMode ?? ""}
            {...fieldAria("paymentMode")}
          >
            <option value="">Any</option>
            {PAYMENT_MODES.map((mode) => (
              <option key={mode.value} value={mode.value}>
                {mode.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" variant="secondary" size="sm">
          <Filter aria-hidden />
          Apply filters
        </Button>

        {active ? (
          <Link
            href={basePath}
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            <X aria-hidden />
            Clear filters
          </Link>
        ) : null}
      </div>
    </form>
  );
}
