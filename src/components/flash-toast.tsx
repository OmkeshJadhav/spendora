"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";

import { flashMessage } from "@/lib/flash";

/**
 * Shows the one-shot message a redirect carried in `?flash=`, then removes the
 * parameter so a refresh does not repeat it.
 *
 * The value arrives as a prop rather than through `useSearchParams` so this
 * never forces a Suspense boundary on the page that renders it.
 */
export function FlashToast({ flash, path }: { flash?: string; path: string }) {
  const router = useRouter();

  useEffect(() => {
    const message = flashMessage(flash);

    if (!message) {
      return;
    }

    toast.success(message, { id: "expense-flash" });
    router.replace(path, { scroll: false });
  }, [flash, path, router]);

  return null;
}
