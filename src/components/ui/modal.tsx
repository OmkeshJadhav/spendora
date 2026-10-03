"use client";

import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from "react";

import { Button } from "@/components/ui/button";

const ModalDismissContext = createContext<(() => void) | null>(null);

/**
 * Closes the enclosing route modal, or null outside one — so a form can offer
 * Cancel as "close" in a modal and as a link on its full page.
 */
export function useModalDismiss(): (() => void) | null {
  return useContext(ModalDismissContext);
}

/**
 * A route rendered as a modal over the page it was opened from (an
 * intercepted route in a parallel `@modal` slot).
 *
 * A native `<dialog>` opened with `showModal()`, so focus is trapped inside,
 * the page behind is inert, and Escape closes it. Closing goes back in
 * history, which is what makes the URL, the back button and the modal agree.
 * A click on the backdrop deliberately does nothing: a half-entered list of
 * items should not vanish to a stray tap.
 */
export function Modal({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  const dismiss = useCallback(() => router.back(), [router]);

  useEffect(() => {
    const dialog = ref.current;

    if (dialog && !dialog.open) {
      dialog.showModal();
    }
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        // Escape: leave closing to the router, so the URL changes with it.
        event.preventDefault();
        dismiss();
      }}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl flex-col overflow-hidden rounded-lg border border-border bg-card p-0 text-card-foreground shadow-lg backdrop:bg-black/50 open:flex"
    >
      <div className="flex items-start justify-between gap-3 border-b border-border p-5 pb-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id={titleId} className="text-lg font-semibold">
            {title}
          </h2>
          {description ? (
            <p id={descriptionId} className="text-sm text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="-mr-2 -mt-2 shrink-0"
          onClick={dismiss}
          aria-label="Close"
        >
          <X aria-hidden />
        </Button>
      </div>

      <div className="overflow-y-auto p-5">
        <ModalDismissContext value={dismiss}>{children}</ModalDismissContext>
      </div>
    </dialog>
  );
}
