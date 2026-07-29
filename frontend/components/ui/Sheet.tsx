"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  /** desktop side; on mobile always renders as a bottom sheet */
  side?: "right" | "left";
}

export function Sheet({ open, onClose, title, children, footer, side = "right" }: SheetProps) {
  React.useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 animate-fade-in bg-scrim/50" onClick={onClose} aria-hidden />
      {/* Mobile: bottom sheet. Desktop (sm+): side sheet. */}
      <div
        className={cn(
          "absolute bg-surface-container-highest shadow-lg",
          // mobile bottom sheet
          "inset-x-0 bottom-0 max-h-[85vh] animate-slide-up rounded-t-3xl",
          // desktop side sheet
          "sm:inset-y-0 sm:bottom-auto sm:top-0 sm:h-full sm:w-full sm:max-w-md sm:rounded-none sm:rounded-l-3xl",
          side === "right" ? "sm:right-0 sm:left-auto" : "sm:left-0 sm:right-auto sm:rounded-l-none sm:rounded-r-3xl"
        )}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-outline-variant px-5 py-4">
            <div className="mx-auto h-1 w-10 rounded-full bg-outline sm:hidden" aria-hidden />
            {title && <h2 className="text-lg font-semibold text-on-surface">{title}</h2>}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <X className="h-5 w-5" strokeWidth={1.75} aria-hidden />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-5">{children}</div>
          {footer && (
            <div className="border-t border-outline-variant px-5 py-4">{footer}</div>
          )}
        </div>
      </div>
    </div>
  );
}
