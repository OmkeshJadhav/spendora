"use client";

import { Toaster as SonnerToaster } from "sonner";

/**
 * Application-wide toast host. Mounted once in the root layout; fire toasts
 * from anywhere with `toast.success(...)` from `sonner`.
 */
function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      closeButton
      toastOptions={{
        classNames: {
          toast:
            "!bg-card !text-card-foreground !border-border !rounded-lg !shadow-lg",
          description: "!text-muted-foreground",
          actionButton: "!bg-primary !text-primary-foreground",
          cancelButton: "!bg-muted !text-muted-foreground",
        },
      }}
    />
  );
}

export { Toaster };
