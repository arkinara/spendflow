import * as React from "react";
import { Calendar } from "lucide-react";
import { cn } from "@/lib/utils";

export interface DateFieldProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: string;
  helper?: string;
  error?: string;
  containerClassName?: string;
}

export const DateField = React.forwardRef<HTMLInputElement, DateFieldProps>(
  function DateField(
    { label, helper, error, className, containerClassName, id, required, ...rest },
    ref
  ) {
    const autoId = React.useId();
    const inputId = id ?? autoId;
    return (
      <div className={cn("space-y-1.5", containerClassName)}>
        {label && (
          <label htmlFor={inputId} className="block text-sm font-medium text-on-surface">
            {label}
            {required && <span className="ml-0.5 text-error">*</span>}
          </label>
        )}
        <div className="relative">
          <Calendar
            className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-on-surface-variant"
            strokeWidth={1.75}
            aria-hidden
          />
          <input
            ref={ref}
            id={inputId}
            type="date"
            required={required}
            aria-invalid={!!error}
            className={cn(
              "h-12 w-full rounded-xl border bg-surface-container-high pl-11 pr-4 text-sm text-on-surface",
              "transition-colors duration-200 ease-m3 focus:outline-none focus:ring-2 [color-scheme:light] dark:[color-scheme:dark]",
              error
                ? "border-error focus:border-error focus:ring-error/40"
                : "border-outline focus:border-primary focus:ring-primary/40",
              "disabled:cursor-not-allowed disabled:opacity-50",
              className
            )}
            {...rest}
          />
        </div>
        {error ? (
          <p className="text-xs text-error">{error}</p>
        ) : helper ? (
          <p className="text-xs text-on-surface-variant">{helper}</p>
        ) : null}
      </div>
    );
  }
);
