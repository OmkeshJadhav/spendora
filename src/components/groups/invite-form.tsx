"use client";

import { Check, Copy, Send } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Field, fieldAria } from "@/components/ui/field";
import { FormField } from "@/components/ui/form-field";
import { Select } from "@/components/ui/select";
import { idleInviteState, type InviteFormState } from "@/lib/groups/invite-state";

/**
 * Invite someone by email (specification section 11).
 *
 * The invitation is created, and from that moment it is waiting in the invitee's
 * own Spendora invitations — no email required, and no link to lose.
 *
 * Email and the one-time link are the fallback for the one case the in-app
 * inbox cannot serve: somebody who has no account yet, and so has no inbox for
 * it to appear in. When the mail cannot be sent, the action hands the link back
 * and it is shown here. That is the only moment it can be shown: only its hash
 * is stored, so nothing can reproduce it afterwards.
 *
 * The action arrives already bound to its group. Binding a Server Action
 * inside a Client Component instead — `inviteMember.bind(null, groupId)` here
 * — makes the server hang forever when the action re-renders this page, so
 * every bind in this codebase happens in the Server Component that renders the
 * form.
 */
export function InviteForm({
  action,
}: {
  action: (
    state: InviteFormState,
    formData: FormData,
  ) => Promise<InviteFormState>;
}) {
  const [state, formAction, pending] = useActionState(action, idleInviteState);

  useEffect(() => {
    if (state.status === "error" && state.message) {
      toast.error(state.message, { id: "group-invite" });
    }

    if (state.status === "success" && state.message) {
      toast.success(state.message, { id: "group-invite" });
    }
  }, [state]);

  return (
    <div className="flex flex-col gap-4">
      <form
        action={formAction}
        className="flex flex-col gap-4 sm:flex-row sm:items-start"
        noValidate
      >
        <div className="flex-1">
          <FormField
            label="Email address"
            name="email"
            type="email"
            placeholder="teammate@example.com"
            defaultValue={state.values?.email}
            errors={state.fieldErrors?.email}
            autoComplete="off"
            required
          />
        </div>

        <div className="sm:w-44">
          <Field name="role" label="Role" errors={state.fieldErrors?.role}>
            <Select
              name="role"
              defaultValue={state.values?.role ?? "member"}
              {...fieldAria("role", { errors: state.fieldErrors?.role })}
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </Select>
          </Field>
        </div>

        <Button type="submit" loading={pending} className="sm:mt-6">
          <Send aria-hidden />
          Send invite
        </Button>
      </form>

      {state.invite?.link ? (
        <InvitationLink email={state.invite.email} link={state.invite.link} />
      ) : null}
    </div>
  );
}

function InvitationLink({ email, link }: { email: string; link: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }

    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      // Clipboard access can be refused; the link is on screen and selectable.
      toast.error("Couldn't copy. Select the link and copy it manually.", {
        id: "group-invite",
      });
    }
  }

  return (
    <div
      // Announced, because it appears after a submit and carries the only copy
      // of something the admin has to act on.
      role="status"
      className="flex flex-col gap-2 rounded-md border border-warning/40 bg-warning/10 p-3"
    >
      <p className="text-sm font-medium">
        If {email} doesn&rsquo;t have an account yet, send them this link
      </p>
      <p className="text-xs text-muted-foreground">
        The invitation is saved — anyone signed in as {email} will find it under
        Invitations. The email couldn&rsquo;t be delivered, so this link is the
        way in for someone who still needs to sign up. It is shown once and only
        works for {email}.
      </p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded border border-border bg-card px-2 py-1.5 text-xs">
          {link}
        </code>
        <Button type="button" variant="secondary" size="sm" onClick={copy}>
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}
