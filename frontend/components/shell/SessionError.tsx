import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/Button";

/**
 * Error state shown when the persisted mock session cannot be read.
 * Replaces an infinite loading skeleton per the #1 negative acceptance criteria.
 */
export function SessionError() {
  return (
    <div
      className="flex min-h-screen items-center justify-center bg-background px-6"
      role="alert"
      aria-live="assertive"
    >
      <div className="w-full max-w-md rounded-2xl border border-outline-variant bg-surface-container-low p-8 text-center">
        <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-error/15 text-error">
          <AlertTriangle className="h-6 w-6" strokeWidth={1.75} aria-hidden />
        </span>
        <h1 className="mt-4 text-lg font-semibold text-on-surface">
          Couldn&rsquo;t load your session
        </h1>
        <p className="mt-2 text-sm text-on-surface-variant">
          We failed to read your saved sign-in. Reloading the page usually fixes it.
        </p>
        <Button className="mt-6" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
    </div>
  );
}
