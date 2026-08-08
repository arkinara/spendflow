"use client";

/* ============================================================================
 * SpendFlow — AddUserDialog (#36).
 *
 * "Add User" dialog: a Finance Admin provisions a new user by email + name +
 * role (+ optional manager/department/job title). Submitting POSTs
 * `/api/admin/users` via the `useUsers.createUser` hook, which prepends the
 * returned `status: "pending"` row to the directory cache. On success the
 * parent closes the dialog and toasts "Invitation sent to …". On failure the
 * dialog stays open and surfaces the BE error inline (e.g. 409
 * `email_exists`).
 * ========================================================================== */

import * as React from "react";
import { Mail, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { TextField } from "@/components/ui/TextField";
import { RolesMultiSelect } from "@/components/ui/RolesMultiSelect";
import { FormErrorBanner } from "@/components/ui/FormErrorBanner";
import { UsersApiError, type BackendUser, type CreateUserInput } from "@/lib/api/users";
import type { Role } from "@/lib/types";

/** Simple email format check (the BE enforces the real policy; this is a
 *  client-side fast fail so a typo never fires a round-trip). */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function AddUserDialog({
  open,
  users,
  currentUserId,
  createUser,
  onClose,
  onCreated,
  onForbidden,
}: {
  open: boolean;
  users: BackendUser[];
  currentUserId: string;
  createUser: (input: CreateUserInput) => Promise<BackendUser>;
  onClose: () => void;
  onCreated: (email: string) => void;
  onForbidden: () => void;
}) {
  const [email, setEmail] = React.useState("");
  const [name, setName] = React.useState("");
  const [roles, setRoles] = React.useState<Role[]>(["employee"]);
  const [managerId, setManagerId] = React.useState("");
  const [department, setDepartment] = React.useState("");
  const [jobTitle, setJobTitle] = React.useState("");
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setEmail("");
      setName("");
      setRoles(["employee"]);
      setManagerId("");
      setDepartment("");
      setJobTitle("");
      setFormError(null);
      setSubmitting(false);
    }
  }, [open]);

  // Candidates for the manager picker: everyone except the signed-in admin.
  const managerOptions = React.useMemo(() => {
    const list = users
      .filter((u) => u.id !== currentUserId)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((u) => ({ value: u.id, label: u.name }));
    return [{ value: "", label: "No manager" }, ...list];
  }, [users, currentUserId]);

  async function submit() {
    const trimmedEmail = email.trim();
    const trimmedName = name.trim();
    if (!EMAIL_RE.test(trimmedEmail)) {
      setFormError("Enter a valid work email address.");
      return;
    }
    if (!trimmedName) {
      setFormError("Enter the user's name.");
      return;
    }
    setFormError(null);
    setSubmitting(true);
    try {
      await createUser({
        email: trimmedEmail,
        name: trimmedName,
        roles,
        managerId: managerId === "" ? undefined : managerId,
        department: department.trim() || undefined,
        jobTitle: jobTitle.trim() || undefined,
      });
      onCreated(trimmedEmail);
    } catch (err) {
      if (err instanceof UsersApiError && err.status === 403) {
        onForbidden();
        return;
      }
      setFormError(
        err instanceof Error
          ? err.message
          : "Could not create the user. Check your connection and try again."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add a user"
      description="Provision a new account. They'll activate it from the invitation email."
      icon={
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-primary/15 text-primary">
          <UserPlus className="h-6 w-6" strokeWidth={1.75} aria-hidden />
        </span>
      }
      footer={
        <>
          <Button variant="text" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? "Sending invite…" : "Send invite"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="rounded-xl bg-surface-container-high px-3 py-2 text-sm text-on-surface-variant">
          We&apos;ll send an invitation email. They&apos;ll need to set a password
          before signing in.
        </p>
        {formError && <FormErrorBanner message={formError} />}
        <TextField
          label="Email"
          type="email"
          iconLeft={Mail}
          placeholder="name@company.example"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (formError) setFormError(null);
          }}
          autoComplete="off"
          required
        />
        <TextField
          label="Name"
          placeholder="Full name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (formError) setFormError(null);
          }}
          autoComplete="off"
          required
        />
        <RolesMultiSelect
          label="Roles"
          required
          roles={roles}
          onChange={setRoles}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Manager"
            options={managerOptions}
            value={managerId}
            onChange={setManagerId}
            placeholder="No manager"
          />
        </div>
        <TextField
          label="Department"
          placeholder="e.g. Operations"
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
          autoComplete="off"
        />
        <TextField
          label="Job title"
          placeholder="e.g. Senior Analyst"
          value={jobTitle}
          onChange={(e) => setJobTitle(e.target.value)}
          autoComplete="off"
        />
      </div>
    </Dialog>
  );
}
