import * as React from "react";
import { cn } from "@/lib/utils";

export interface CardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  footer?: React.ReactNode;
  interactive?: boolean;
  padded?: boolean;
}

export function Card({
  title,
  subtitle,
  action,
  footer,
  interactive = false,
  padded = true,
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-outline-variant bg-surface-container-low shadow-sm transition-colors duration-200 ease-m3",
        interactive &&
          "cursor-pointer hover:bg-surface-container focus-within:ring-2 focus-within:ring-primary",
        className
      )}
      {...rest}
    >
      {(title || action) && (
        <div className="flex items-start justify-between gap-4 px-5 pt-5">
          <div className="min-w-0">
            {title && (
              <h3 className="truncate text-base font-semibold text-on-surface">{title}</h3>
            )}
            {subtitle && (
              <p className="mt-0.5 text-sm text-on-surface-variant">{subtitle}</p>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div className={cn(padded && "p-5", padded && (title || action) && "pt-4")}>
        {children}
      </div>
      {footer && (
        <div className="border-t border-outline-variant px-5 py-4">{footer}</div>
      )}
    </div>
  );
}
