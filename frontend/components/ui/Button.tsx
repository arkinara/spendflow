import * as React from "react";
import Link from "next/link";
import { Loader2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type ButtonVariant =
  | "filled"
  | "tonal"
  | "outlined"
  | "text"
  | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const BASE =
  "relative inline-flex items-center justify-center gap-2 rounded-full font-medium " +
  "transition-all duration-200 ease-m3 select-none whitespace-nowrap " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background " +
  "disabled:pointer-events-none disabled:opacity-40 active:scale-[0.98]";

const VARIANTS: Record<ButtonVariant, string> = {
  filled:
    "bg-primary text-primary-foreground hover:brightness-110 shadow-sm hover:shadow",
  tonal:
    "bg-secondary-container text-secondary-container-foreground hover:brightness-105",
  outlined:
    "border border-outline text-primary hover:bg-primary/10",
  text: "text-primary hover:bg-primary/10",
  danger: "bg-error text-error-container hover:brightness-110 shadow-sm",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-9 px-4 text-sm",
  md: "h-11 px-6 text-sm",
  lg: "h-12 px-8 text-base",
};

interface CommonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  iconRight?: LucideIcon;
  loading?: boolean;
  fullWidth?: boolean;
  className?: string;
  children?: React.ReactNode;
}

type ButtonAsButton = CommonProps &
  Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, keyof CommonProps> & {
    href?: undefined;
  };

type ButtonAsLink = CommonProps & {
  href: string;
};

export type ButtonProps = ButtonAsButton | ButtonAsLink;

export function Button(props: ButtonProps) {
  const {
    variant = "filled",
    size = "md",
    icon: Icon,
    iconRight: IconRight,
    loading = false,
    fullWidth = false,
    className,
    children,
  } = props;

  const classes = cn(
    BASE,
    VARIANTS[variant],
    SIZES[size],
    fullWidth && "w-full",
    className
  );

  const content = (
    <>
      {loading && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} aria-hidden />}
      {!loading && Icon && <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden />}
      {children}
      {!loading && IconRight && (
        <IconRight className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden />
      )}
    </>
  );

  if ("href" in props && props.href !== undefined) {
    return (
      <Link href={props.href} className={classes} aria-busy={loading}>
        {content}
      </Link>
    );
  }

  const {
    // strip non-DOM props so they don't reach the element
    variant: _v,
    size: _s,
    icon: _i,
    iconRight: _ir,
    loading: _l,
    fullWidth: _fw,
    className: _c,
    children: _ch,
    disabled,
    ...rest
  } = props as ButtonAsButton;
  return (
    <button
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading}
      {...rest}
    >
      {content}
    </button>
  );
}
