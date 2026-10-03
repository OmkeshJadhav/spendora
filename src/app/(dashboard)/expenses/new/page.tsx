import type { Metadata } from "next";

import { PersonalExpenseEntry } from "@/components/expenses/expense-entry";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FadeIn } from "@/components/ui/fade-in";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = {
  title: "Add expense",
};

export default function NewExpensePage() {
  return (
    <FadeIn className="mx-auto flex w-full max-w-xl flex-col gap-6">
      <PageHeader
        title="Add expense"
        description="Record what you spent. Bought several things at once? Add each as its own item."
      />

      <Card>
        <CardHeader>
          <CardTitle>Expense details</CardTitle>
          <CardDescription>
            Personal expenses — nobody else can see them.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PersonalExpenseEntry />
        </CardContent>
      </Card>
    </FadeIn>
  );
}
