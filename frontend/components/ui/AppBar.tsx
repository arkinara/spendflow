"use client";

import * as React from "react";
import Link from "next/link";
import { Bell, LogOut, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./ThemeToggle";
import { Avatar } from "./Avatar";

export interface AppBarProps {
  title?: string;
  unreadCount?: number;
  action?: React.ReactNode;
  user?: { name: string; subtitle?: string; color?: string };
  homeHref?: string;
  onSignOut?: () => void;
}

export function AppBar({
  title = "SpendFlow",
  unreadCount = 0,
  action,
  user,
  homeHref = "/",
  onSignOut,
}: AppBarProps) {
  return (
    <header
      className="sticky top-0 z-40 flex h-16 items-center justify-between gap-3 border-b border-outline-variant bg-surface-container-high px-4 sm:px-6"
      aria-label="Top bar"
    >
      <div className="flex min-w-0 items-center gap-3">
        <Link
          href={homeHref}
          aria-label={`${title} home`}
          className="flex items-center gap-2.5 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Wallet className="h-5 w-5" strokeWidth={2} aria-hidden />
          </span>
          <span className="hidden text-lg font-semibold tracking-tight text-on-surface sm:inline">
            {title}
          </span>
        </Link>
      </div>

      <div className="flex items-center gap-1.5 sm:gap-2">
        {action && <div className="hidden sm:block">{action}</div>}
        <Link
          href="/notifications"
          aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ""}`}
          className="relative inline-flex h-11 w-11 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-highest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Bell className="h-5 w-5" strokeWidth={1.75} aria-hidden />
          {unreadCount > 0 && (
            <span
              className={cn(
                "absolute right-1.5 top-1.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-error px-1 text-[10px] font-bold text-error-container"
              )}
            >
              {unreadCount}
            </span>
          )}
        </Link>
        <ThemeToggle />
        {onSignOut && (
          <button
            type="button"
            onClick={onSignOut}
            aria-label="Sign out"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-highest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <LogOut className="h-5 w-5" strokeWidth={1.75} aria-hidden />
          </button>
        )}
        {user && (
          <div className="ml-1 hidden items-center gap-2 md:flex">
            <Avatar name={user.name} size="sm" color={(user.color as never) ?? "primary"} />
            <div className="hidden leading-tight lg:block">
              <p className="text-sm font-medium text-on-surface">{user.name}</p>
              {user.subtitle && (
                <p className="text-xs text-on-surface-variant">{user.subtitle}</p>
              )}
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
