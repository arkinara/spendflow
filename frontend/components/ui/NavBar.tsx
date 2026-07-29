"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  badge?: number;
}

export interface NavBarProps {
  items: NavItem[];
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export function NavBar({ items }: NavBarProps) {
  const pathname = usePathname();

  return (
    <>
      {/* Rail — tablet (icon only) + desktop (expanded). */}
      <aside
        className="fixed bottom-0 left-0 top-16 z-20 hidden w-20 flex-col gap-1 border-r border-outline-variant bg-surface-container-high px-2 py-4 sm:flex lg:w-64 lg:px-3"
        aria-label="Primary"
      >
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group flex items-center gap-3 rounded-full px-3 py-3 text-sm font-medium transition-colors duration-200 ease-m3 lg:min-h-[48px]",
                "justify-center lg:justify-start",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface"
              )}
            >
              <span className="relative">
                <Icon className="h-6 w-6" strokeWidth={1.75} aria-hidden />
                {item.badge ? (
                  <span className="absolute -right-1.5 -top-1.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-error px-1 text-[10px] font-bold text-error-container">
                    {item.badge}
                  </span>
                ) : null}
              </span>
              <span className="hidden lg:inline">{item.label}</span>
            </Link>
          );
        })}
      </aside>

      {/* Bottom nav — mobile. */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 flex items-stretch justify-around border-t border-outline-variant bg-surface-container-high px-1 pb-[env(safe-area-inset-bottom)] pt-1.5 sm:hidden"
        aria-label="Primary"
      >
        {items.slice(0, 5).map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className="flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 rounded-2xl px-1 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <span
                className={cn(
                  "relative inline-flex h-8 w-14 items-center justify-center rounded-full transition-colors duration-200",
                  active ? "bg-primary/15 text-primary" : "text-on-surface-variant"
                )}
              >
                <Icon className="h-[22px] w-[22px]" strokeWidth={1.75} aria-hidden />
                {item.badge ? (
                  <span className="absolute right-2 top-0.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-error px-1 text-[10px] font-bold text-error-container">
                    {item.badge}
                  </span>
                ) : null}
              </span>
              <span
                className={cn(
                  "text-[11px] font-medium",
                  active ? "text-primary" : "text-on-surface-variant"
                )}
              >
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
