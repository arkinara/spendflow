"use client";

import * as React from "react";
import { createClaim, type ClaimInput } from "@/lib/mock/claimStore";

/**
 * Simulated async submission of a claim against the mock store.
 *
 * The store is synchronous, but submission still runs through a loading state
 * and an explicit, retry-capable error state — matching the ticket's negative
 * acceptance criteria (no infinite spinner, no data loss on failure). The
 * component's draft state is untouched on failure, so retry preserves every
 * entered field and warning.
 */
export type SubmitState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "success"; claimId: string }
  | { status: "error"; message: string };

export interface UseSubmitClaim {
  state: SubmitState;
  submit: (input: ClaimInput) => void;
  reset: () => void;
}

const SIMULATED_LATENCY_MS = 600;

export function useSubmitClaim(): UseSubmitClaim {
  const [state, setState] = React.useState<SubmitState>({ status: "idle" });

  const submit = React.useCallback((input: ClaimInput) => {
    setState({ status: "submitting" });
    window.setTimeout(() => {
      try {
        const claim = createClaim(input);
        setState({ status: "success", claimId: claim.id });
      } catch (err) {
        setState({
          status: "error",
          message:
            err instanceof Error
              ? err.message
              : "We couldn't submit your claim. Your entries are saved — try again.",
        });
      }
    }, SIMULATED_LATENCY_MS);
  }, []);

  const reset = React.useCallback(() => {
    setState({ status: "idle" });
  }, []);

  return { state, submit, reset };
}
