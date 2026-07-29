import * as React from "react";
import { cn } from "@/lib/utils";

export interface TextAreaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  helper?: string;
  error?: string;
  containerClassName?: string;
}

export const TextArea = React.forwardRef<HTMLTextAreaElement, TextAreaProps>(
  function TextArea(
    { label, helper, error, className, containerClassName, id, required, rows = 4, ...rest },
    ref
  ) {
    const autoId = React.useId();
    const areaId = id ?? autoId;
    const describedBy = error ? `${areaId}-err` : helper ? `${areaId}-help` : undefined;

    return (
      <div className={cn("space-y-1.5", containerClassName)}>
        {label && (
          <label htmlFor={areaId} className="block text-sm font-medium text-on-surface">
            {label}
            {required && <span className="ml-0.5 text-error">*</span>}
          </label>
        )}
        <textarea
          ref={ref}
          id={areaId}
          rows={rows}
          required={required}
          aria-invalid={!!error}
          aria-describedby={describedBy}
          className={cn(
            "w-full resize-y rounded-xl border bg-surface-container-high px-4 py-3 text-sm text-on-surface",
            "placeholder:text-on-surface-variant/70 transition-colors duration-200 ease-m3",
            "focus:outline-none focus:ring-2",
            error
              ? "border-error focus:border-error focus:ring-error/40"
              : "border-outline focus:border-primary focus:ring-primary/40",
            "disabled:cursor-not-allowed disabled:opacity-50",
            className
          )}
          {...rest}
        />
        {error ? (
          <p id={`${areaId}-err`} className="text-xs text-error">
            {error}
          </p>
        ) : helper ? (
          <p id={`${areaId}-help`} className="text-xs text-on-surface-variant">
            {helper}
          </p>
        ) : null}
      </div>
    );
  }
);
