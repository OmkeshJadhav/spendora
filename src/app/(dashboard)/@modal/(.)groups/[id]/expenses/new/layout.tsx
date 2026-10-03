import { Modal } from "@/components/ui/modal";

/** As the personal "Add expense" modal, for a group's expenses. */
export default function AddGroupExpenseModalLayout({
  children,
}: LayoutProps<"/groups/[id]/expenses/new">) {
  return (
    <Modal
      title="Add group expense"
      description="Everyone in this group can see these expenses. Amounts are recorded in the group's currency."
    >
      {children}
    </Modal>
  );
}
