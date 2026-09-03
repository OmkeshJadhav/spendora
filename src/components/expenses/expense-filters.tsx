import { Filter, X } from "lucide-react";
import Link from "next/link";

import { Button, buttonVariants } from "@/components/ui/button";
import { Field, fieldAria } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { PAYMENT_MODES } from "@/lib/constants";
import { MIN_EXPENSE_DATE, maxExpenseDate } from "@/lib/dates";
import type { ExpenseCategory } from "@/lib/expenses/queries";
import {
  FILTER_UNCATEGORISED,
  hasActiveFilters,
  SEARCH_MAX_LENGTH,
  type ExpenseFilters,
} from "@/lib/expenses/filters";

/**
 * Search and filters for an expense list (specification section 24).
 *
 * A plain GET form: the filters end up in the query string, so the view is
 * linkable, survives a refresh and works with JavaScript turned off. Clearing
 * them is a link back to the unfiltered list rather than a reset button, for
 * the same reason.
 *
 * Two consequences of it being a GET form are deliberate rather than
 * incidental. Submitting replaces the whole query string, so applying a filter
 * returns to page one — a page 3 of the old result set is not a page of the
 * new one. And the form has no `month` field, so choosing dates drops the
 * month scope instead of silently losing to it.
 *
 * The same bar serves personal and group lists. "Paid by" appears only when
 * members are given: on a personal list every expense is the viewer's own, so
 * the control would have exactly one option.
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
  /** The group's members. Omitted on a personal list. */
  members?: { id: string; name: string; isSelf: boolean }[];
}) {
  const active = hasActiveFilters(filters);
  const latest = maxExpenseDate();

  return (
    <form
      action={basePath}
      method="get"
      className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4"
      aria-label="Search and filter expenses"
    >
      <Field
        name="q"
        label="Search"
        hint="Matches the item name or the notes."
      >
        <Input
          type="search"
          name="q"
          defaultValue={filters.search ?? ""}
          maxLength={SEARCH_MAX_LENGTH}
          placeholder="Groceries, dinner with friends…"
          {...fieldAria("q", { hasHint: true })}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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

        {members ? (
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
        ) : null}

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

        {/* Either end may be left blank: "everything since April" is a range. */}
        <Field name="from" label="From date">
          <Input
            type="date"
            name="from"
            defaultValue={filters.from ?? ""}
            min={MIN_EXPENSE_DATE}
            max={latest}
            {...fieldAria("from")}
          />
        </Field>

        <Field name="to" label="To date">
          <Input
            type="date"
            name="to"
            defaultValue={filters.to ?? ""}
            min={MIN_EXPENSE_DATE}
            max={latest}
            {...fieldAria("to")}
          />
        </Field>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" variant="secondary" size="sm">
          <Filter aria-hidden />
          Apply
        </Button>

        {active ? (
          <Link
            href={basePath}
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            <X aria-hidden />
            Clear all
          </Link>
        ) : null}
      </div>
    </form>
  );
}
