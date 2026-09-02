import { Wallet } from "lucide-react";
import Link from "next/link";

import { APP_NAME } from "@/lib/constants";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <Link
          href="/"
          className="mb-8 flex items-center justify-center gap-2 text-sm font-medium rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Wallet className="size-4 text-primary" aria-hidden />
          {APP_NAME}
        </Link>
        {children}
      </div>
    </div>
  );
}
