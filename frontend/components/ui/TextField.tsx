import * as React from "react";
import { type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface TextFieldProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  label?: string;
  helper?: string;
  error?: string;
  iconLeft?: LucideIcon;
  iconRight?: LucideIcon;
  containerClassName?: string;
}

export const TextField = React.forwardRef<HTMLInputElement, TextFieldProps>(
  function TextField(
    { label, helper, error, iconLeft: IconLeft, iconRight: IconRight, className, containerClassName, id, required, disabled, ...rest },
    ref
  ) {
    const autoId = React.useId();
    const inputId = id ?? autoId;
    const describedBy = error ? `${inputId}-err` : helper ? `${inputId}-help` : undefined;

    return (
      <div className={cn("space-y-1.5", containerClassName)}>
        {label && (
          <label htmlFor={inputId} className="block text-sm font-medium text-on-surface">
            {label}
            {required && <span className="ml-0.5 text-error">*</span>}
          </label>
        )}
        <div className="relative">
          {IconLeft && (
            <IconLeft
              className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-on-surface-variant"
              strokeWidth={1.75}
              aria-hidden
            />
          )}
          <input
            ref={ref}
            id={inputId}
            required={required}
            disabled={disabled}
            aria-invalid={!!error}
            aria-describedby={describedBy}
            className={cn(
              "h-12 w-full rounded-xl border bg-surface-container-high px-4 text-sm text-on-surface",
              "placeholder:text-on-surface-variant/70 transition-colors duration-200 ease-m3",
              "focus:outline-none focus:ring-2",
              IconLeft && "pl-11",
              IconRight && "pr-11",
              error
                ? "border-error focus:border-error focus:ring-error/40"
                : "border-outline focus:border-primary focus:ring-primary/40",
              "disabled:cursor-not-allowed disabled:opacity-50",
              className
            )}
            {...rest}
          />
          {IconRight && (
            <IconRight
              className="pointer-events-none absolute right-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-on-surface-variant"
              strokeWidth={1.75}
              aria-hidden
            />
          )}
        </div>
        {error ? (
          <p id={`${inputId}-err`} className="text-xs text-error">
            {error}
          </p>
        ) : helper ? (
          <p id={`${inputId}-help`} className="text-xs text-on-surface-variant">
            {helper}
          </p>
        ) : null}
      </div>
    );
  }
);
