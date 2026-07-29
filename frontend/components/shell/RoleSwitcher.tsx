"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Check, UserCog } from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/Avatar";
import {
  users,
  CURRENT_USER_BY_ROLE,
  getUser,
  type Role,
  type User,
} from "@/lib/mock/mock_data";

interface RoleContextValue {
  role: Role;
  setRole: (role: Role) => void;
  user: User;
}

const RoleContext = React.createContext<RoleContextValue | null>(null);

export function useRole(): RoleContextValue {
  const ctx = React.useContext(RoleContext);
  if (!ctx) throw new Error("useRole must be used within <RoleProvider>");
  return ctx;
}

const STORAGE_KEY = "spendflow.role";
const ROLE_LABEL: Record<Role, string> = {
  employee: "Employee",
  approver: "Approver",
  finance: "Finance Admin",
};

export function RoleProvider({ children }: { children: React.ReactNode }) {
  const [role, setRoleState] = React.useState<Role>("employee");

  React.useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY) as Role | null;
    if (stored && stored in CURRENT_USER_BY_ROLE) setRoleState(stored);
  }, []);

  const setRole = React.useCallback((r: Role) => {
    setRoleState(r);
    window.localStorage.setItem(STORAGE_KEY, r);
  }, []);

  const user = getUser(CURRENT_USER_BY_ROLE[role])!;

  return (
    <RoleContext.Provider value={{ role, setRole, user }}>
      {children}
    </RoleContext.Provider>
  );
}

const ROLE_HOME: Record<Role, string> = {
  employee: "/employee",
  approver: "/approver",
  finance: "/finance",
};

export function RoleSwitcher() {
  const { role, setRole } = useRole();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const roleUsers = (Object.keys(CURRENT_USER_BY_ROLE) as Role[]).map(
    (r) => ({ role: r, user: getUser(CURRENT_USER_BY_ROLE[r])! })
  );

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-2 rounded-full border border-outline-variant bg-surface-container px-2.5 py-1.5 text-xs font-medium text-on-surface-variant transition-colors hover:bg-surface-container-highest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <UserCog className="h-4 w-4 text-primary" strokeWidth={1.75} aria-hidden />
        <span className="hidden sm:inline">Viewing as</span>
        <span className="font-semibold text-on-surface">{ROLE_LABEL[role]}</span>
        <ChevronDown
          className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")}
          strokeWidth={2}
          aria-hidden
        />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-64 animate-fade-in overflow-hidden rounded-2xl border border-outline-variant bg-surface-container-high p-1.5 shadow-lg"
        >
          <p className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant">
            Demo role (dev only)
          </p>
          {roleUsers.map(({ role: r, user: u }) => {
            const active = r === role;
            return (
              <button
                key={r}
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  setRole(r);
                  setOpen(false);
                  router.push(ROLE_HOME[r]);
                }}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
                  active ? "bg-primary/10" : "hover:bg-surface-container-highest"
                )}
              >
                <Avatar name={u.name} size="sm" color={u.avatarColor as never} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-on-surface">{u.name}</p>
                  <p className="truncate text-xs text-on-surface-variant">{ROLE_LABEL[r]}</p>
                </div>
                {active && <Check className="h-4 w-4 text-primary" strokeWidth={2} aria-hidden />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export { users, ROLE_LABEL };
