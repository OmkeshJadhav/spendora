import { GroupExpenseEntry } from "@/components/expenses/expense-entry";

export default async function AddGroupExpenseModal(
  props: PageProps<"/groups/[id]/expenses/new">,
) {
  const { id } = await props.params;

  return <GroupExpenseEntry groupId={id} />;
}
