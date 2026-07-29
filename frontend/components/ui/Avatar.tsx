import { cn } from "@/lib/utils";
import { initials } from "@/lib/format";

type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl";
type AvatarColor =
  | "primary"
  | "secondary"
  | "tertiary"
  | "info"
  | "warning"
  | "success"
  | "error";

const SIZES: Record<AvatarSize, string> = {
  xs: "h-7 w-7 text-[11px]",
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-12 w-12 text-base",
  xl: "h-16 w-16 text-xl",
};

const COLORS: Record<AvatarColor, string> = {
  primary: "bg-primary-container text-primary-container-foreground",
  secondary: "bg-secondary-container text-secondary-container-foreground",
  tertiary: "bg-tertiary-container text-tertiary-container-foreground",
  info: "bg-info-container text-info-container-foreground",
  warning: "bg-warning-container text-warning-container-foreground",
  success: "bg-success-container text-success-container-foreground",
  error: "bg-error-container text-error-container-foreground",
};

export interface AvatarProps {
  name: string;
  size?: AvatarSize;
  color?: AvatarColor;
  className?: string;
}

export function Avatar({ name, size = "md", color = "primary", className }: AvatarProps) {
  return (
    <span
      role="img"
      aria-label={name}
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold",
        SIZES[size],
        COLORS[color],
        className
      )}
    >
      {initials(name)}
    </span>
  );
}
