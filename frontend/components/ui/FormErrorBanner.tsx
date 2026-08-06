import { AlertTriangle } from "lucide-react";

/** Inline error banner used inside form dialogs (role/manager/status/add-user/
 *  bulk/delete). `message` may be a plain string or JSX (e.g. the bulk-failure
 *  list with the failing user ids). */
export function FormErrorBanner({ message }: { message: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-xl bg-error-container px-3 py-2 text-sm text-error-container-foreground"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
      <div className="min-w-0 flex-1 space-y-1.5">{message}</div>
    </div>
  );
}
