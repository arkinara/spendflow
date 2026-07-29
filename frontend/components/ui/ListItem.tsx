import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ListItemProps {
  leading?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  meta?: React.ReactNode;
  trailing?: React.ReactNode;
  href?: string;
  onClick?: () => void;
  showChevron?: boolean;
  className?: string;
}

export function ListItem({
  leading,
  title,
  subtitle,
  meta,
  trailing,
  href,
  onClick,
  showChevron = false,
  className,
}: ListItemProps) {
  const interactive = !!href || !!onClick;
  const inner = (
    <>
      {leading && <div className="shrink-0">{leading}</div>}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-on-surface">{title}</div>
        {subtitle && (
          <div className="truncate text-xs text-on-surface-variant">{subtitle}</div>
        )}
      </div>
      {meta && <div className="shrink-0 text-right text-xs text-on-surface-variant">{meta}</div>}
      {trailing && <div className="shrink-0">{trailing}</div>}
      {showChevron && (
        <ChevronRight className="h-5 w-5 shrink-0 text-on-surface-variant" strokeWidth={1.75} aria-hidden />
      )}
    </>
  );

  const classes = cn(
    "flex min-h-[56px] w-full items-center gap-4 rounded-2xl px-4 py-3 text-left transition-colors duration-200 ease-m3",
    interactive &&
      "hover:bg-surface-container-high active:bg-surface-container-highest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
    className
  );

  if (href) {
    return (
      <Link href={href} className={classes}>
        {inner}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={classes}>
        {inner}
      </button>
    );
  }
  return <div className={classes}>{inner}</div>;
}
