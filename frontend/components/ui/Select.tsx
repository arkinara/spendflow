"use client";

import * as React from "react";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  label?: string;
  helper?: string;
  error?: string;
  placeholder?: string;
  options: SelectOption[];
  value?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  containerClassName?: string;
  className?: string;
}

export function Select({
  label,
  helper,
  error,
  placeholder = "Select…",
  options,
  value,
  onChange,
  disabled,
  required,
  containerClassName,
  className,
}: SelectProps) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const autoId = React.useId();
  const selected = options.find((o) => o.value === value);

  React.useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  return (
    <div className={cn("space-y-1.5", containerClassName)} ref={ref}>
      {label && (
        <label htmlFor={autoId} className="block text-sm font-medium text-on-surface">
          {label}
          {required && <span className="ml-0.5 text-error">*</span>}
        </label>
      )}
      <div className="relative">
        <button
          id={autoId}
          type="button"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-invalid={!!error}
          onClick={() => setOpen((v) => !v)}
          className={cn(
            "flex h-12 w-full items-center justify-between gap-2 rounded-xl border bg-surface-container-high px-4 text-left text-sm",
            "transition-colors duration-200 ease-m3 focus:outline-none focus:ring-2",
            error
              ? "border-error focus:border-error focus:ring-error/40"
              : "border-outline focus:border-primary focus:ring-primary/40",
            "disabled:cursor-not-allowed disabled:opacity-50",
            className
          )}
        >
          <span className={cn(selected ? "text-on-surface" : "text-on-surface-variant/70")}>
            {selected ? selected.label : placeholder}
          </span>
          <ChevronDown
            className={cn(
              "h-[18px] w-[18px] text-on-surface-variant transition-transform duration-200",
              open && "rotate-180"
            )}
            strokeWidth={1.75}
            aria-hidden
          />
        </button>
        {open && (
          <ul
            role="listbox"
            className="absolute z-40 mt-1 max-h-64 w-full animate-fade-in overflow-auto rounded-xl border border-outline-variant bg-surface-container-high p-1 shadow-lg"
          >
            {options.map((opt) => {
              const active = opt.value === value;
              return (
                <li key={opt.value} role="option" aria-selected={active}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange?.(opt.value);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
                      active
                        ? "bg-primary/10 text-primary"
                        : "text-on-surface hover:bg-surface-container-highest"
                    )}
                  >
                    {opt.label}
                    {active && <Check className="h-4 w-4" strokeWidth={1.75} aria-hidden />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {error ? (
        <p className="text-xs text-error">{error}</p>
      ) : helper ? (
        <p className="text-xs text-on-surface-variant">{helper}</p>
      ) : null}
    </div>
  );
}
