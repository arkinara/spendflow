"use client";

import * as React from "react";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Toast = {
  id: number;
  message: string;
  tone: "success" | "error" | "info";
  action?: { label: string; onClick: () => void };
};

interface SnackbarContextValue {
  show: (
    message: string,
    opts?: { tone?: Toast["tone"]; action?: Toast["action"] }
  ) => void;
}

const SnackbarContext = React.createContext<SnackbarContextValue | null>(null);

export function useSnackbar(): SnackbarContextValue {
  const ctx = React.useContext(SnackbarContext);
  if (!ctx) throw new Error("useSnackbar must be used within <SnackbarProvider>");
  return ctx;
}

const TONE_ICON = {
  success: CheckCircle2,
  error: AlertTriangle,
  info: Info,
} as const;

export function SnackbarProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const counter = React.useRef(0);

  const remove = React.useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const show = React.useCallback<SnackbarContextValue["show"]>(
    (message, opts) => {
      const id = ++counter.current;
      const toast: Toast = { id, message, tone: opts?.tone ?? "info", action: opts?.action };
      setToasts((t) => [...t, toast]);
      setTimeout(() => remove(id), 4500);
    },
    [remove]
  );

  return (
    <SnackbarContext.Provider value={{ show }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6">
        {toasts.map((t) => {
          const Icon = TONE_ICON[t.tone];
          return (
            <div
              key={t.id}
              role="status"
              className="pointer-events-auto flex w-full max-w-md animate-slide-up items-center gap-3 rounded-xl bg-inverse-surface px-4 py-3 text-inverse-on-surface shadow-lg"
            >
              <Icon
                className={cn(
                  "h-5 w-5 shrink-0",
                  t.tone === "success" && "text-success",
                  t.tone === "error" && "text-error",
                  t.tone === "info" && "text-info"
                )}
                strokeWidth={1.75}
                aria-hidden
              />
              <span className="flex-1 text-sm">{t.message}</span>
              {t.action && (
                <button
                  type="button"
                  onClick={() => {
                    t.action?.onClick();
                    remove(t.id);
                  }}
                  className="text-sm font-semibold uppercase tracking-wide text-inverse-primary hover:underline"
                >
                  {t.action.label}
                </button>
              )}
              <button
                type="button"
                onClick={() => remove(t.id)}
                aria-label="Dismiss"
                className="inline-flex h-7 w-7 items-center justify-center rounded-full text-inverse-on-surface/70 transition-colors hover:bg-inverse-on-surface/10"
              >
                <X className="h-4 w-4" strokeWidth={1.75} aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
    </SnackbarContext.Provider>
  );
}
