import { Modal } from "@/components/ui/modal";

/**
 * "Add expense" opened from inside the app: the form in a modal over the
 * current page. Visiting `/expenses/new` directly still renders the full page.
 * The modal lives in a layout so it stays open while the form loads.
 */
export default function AddExpenseModalLayout({
  children,
}: LayoutProps<"/expenses/new">) {
  return (
    <Modal
      title="Add expense"
      description="Personal expenses — nobody else can see them."
    >
      {children}
    </Modal>
  );
}
