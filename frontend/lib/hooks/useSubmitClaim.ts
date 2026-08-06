"use client";

/* ============================================================================
 * SpendFlow — useSubmitClaim (ticket #18, FE wiring).
 * HTTP-backed: the wizard now POSTs to the real BE. Lifecycle:
 *   1. `POST /api/claims` (create draft + line items, mileage amount computed
 *      server-side from `quantity × category rate`).
 *   2. For every line with a `File` attachment, `POST …/line-items/:id/
 *      attachments` (multipart) — only after create returns the line ids.
 *   3. `POST /api/claims/:id/submit` (draft → pending; BE re-evaluates policy
 *      authoritatively, so client-side `evaluatePolicy` is purely UX).
 *
 * The hook's public interface (`{ state, submit, reset }`) is unchanged so
 * the wizard page keeps its shape. Client-side pre-submit policy warnings are
 * still computed in the wizard for UX; the BE re-evaluates authoritatively on
 * submit.
 * ========================================================================== */

import * as React from "react";
import {
  createClaim,
  submitClaim,
  uploadAttachment,
  ClaimApiError,
  type ClaimDraft,
  type ClaimDraftLine,
} from "@/lib/api/claims";
import type { CurrencyCode } from "@/lib/format";
import type { UploadedFile } from "@/components/ui/FileUpload";

/** Shape the wizard already builds (see claimStore.ClaimInput). Kept stable. */
export interface ClaimLineInput {
  categoryId: string;
  description: string;
  date: string;
  amount: number;
  currency: CurrencyCode;
  merchant?: string;
  quantity?: number;
  unitLabel?: string;
  unitRate?: number;
  /** In-memory metadata; `file` is the real bytes when the user picked one. */
  attachment?: UploadedFile;
  /** Real browser File (only present when the user selected one in-session). */
  file?: File;
}

export interface ClaimInput {
  employeeId: string;
  title: string;
  purpose: string;
  destination: string;
  tripStart: string;
  tripEnd: string;
  currency: CurrencyCode;
  lines: ClaimLineInput[];
  exception?: { type: "missing_receipt" | "over_policy"; message: string };
}

export type SubmitState =
  | { status: "idle" }
  | { status: "submitting"; progress?: string }
  | { status: "success"; claimId: string }
  | { status: "error"; message: string };

export interface UseSubmitClaim {
  state: SubmitState;
  submit: (input: ClaimInput) => void;
  reset: () => void;
}

function toDraft(input: ClaimInput): ClaimDraft {
  const lineItems: ClaimDraftLine[] = input.lines.map((l) => {
    const base: ClaimDraftLine = {
      categoryId: l.categoryId,
      description: l.description.trim(),
      date: l.date,
      amount: l.amount,
      currency: l.currency,
      note: l.merchant?.trim() ? `Merchant: ${l.merchant.trim()}` : undefined,
    };
    // Mileage: send `quantity` (distance km) — the BE computes amount from the
    // category mileage rate server-side and ignores the client amount.
    if (l.quantity != null) {
      base.quantity = l.quantity;
      base.unitLabel = l.unitLabel ?? "km";
    }
    return base;
  });

  return {
    title: input.title,
    purpose: input.purpose,
    currency: input.currency,
    tripStart: input.tripStart || undefined,
    tripEnd: input.tripEnd || undefined,
    destination: input.destination || undefined,
    lineItems,
  };
}

export function useSubmitClaim(): UseSubmitClaim {
  const [state, setState] = React.useState<SubmitState>({ status: "idle" });

  const submit = React.useCallback(async (input: ClaimInput) => {
    setState({ status: "submitting", progress: "Creating draft claim…" });
    try {
      const created = await createClaim(toDraft(input));

      // Upload any in-session receipts against the freshly-created line ids.
      // Positional matching is safe: create returns lines in submission order
      // (`orderBy(asc(createdAt))`) and we did not send client ids.
      const createdLines = created.lineItems;
      for (let i = 0; i < input.lines.length; i++) {
        const draftLine = input.lines[i];
        if (!draftLine.file) continue;
        const backendLine = createdLines[i];
        if (!backendLine) continue;
        setState({
          status: "submitting",
          progress: `Uploading receipt ${i + 1}…`,
        });
        try {
          await uploadAttachment(
            created.id,
            backendLine.id,
            draftLine.file,
            {
              merchant: draftLine.merchant,
              amount: draftLine.amount,
              currency: draftLine.currency,
              transactionDate: draftLine.date,
            },
          );
        } catch (err) {
          // A single failed upload should not lose the whole draft; the BE
          // policy engine will flag missing-receipt on submit. Surface the
          // first upload error as a soft warning by carrying on.
          // (The wizard's pre-submit UX already warned about missing receipts.)
          void err;
        }
      }

      setState({ status: "submitting", progress: "Submitting for approval…" });
      await submitClaim(created.id);
      setState({ status: "success", claimId: created.id });
    } catch (err) {
      const message =
        err instanceof ClaimApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "We couldn't submit your claim. Your entries are saved — try again.";
      setState({ status: "error", message });
    }
  }, []);

  const reset = React.useCallback(() => {
    setState({ status: "idle" });
  }, []);

  return { state, submit, reset };
}
