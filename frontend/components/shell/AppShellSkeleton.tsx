import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Loading skeleton shown while the mock session resolves (and during auth
 * redirects). Mirrors the AppShell layout: sticky top bar, side rail, content.
 */
export function AppShellSkeleton() {
  return (
    <div className="min-h-screen bg-background" aria-busy="true">
      {/* AppBar */}
      <div className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-outline-variant bg-surface-container-high px-4 sm:px-6">
        <div className="flex items-center gap-2.5">
          <Skeleton className="h-9 w-9 rounded-xl" />
          <Skeleton className="hidden h-5 w-28 sm:block" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-11 w-11 rounded-full" />
          <Skeleton className="h-11 w-11 rounded-full" />
        </div>
      </div>

      {/* Rail (tablet/desktop) */}
      <div
        className="fixed bottom-0 left-0 top-16 z-20 hidden w-20 flex-col gap-2 border-r border-outline-variant bg-surface-container-high px-2 py-4 md:flex lg:w-64 lg:px-3"
        aria-hidden
      >
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-full" />
        ))}
      </div>

      {/* Content */}
      <main
        className="pb-24 pt-6 md:pl-20 md:pb-8 lg:pl-64"
        role="status"
        aria-label="Loading workspace"
      >
        <div className="mx-0 w-full px-4 sm:px-6 lg:px-8">
          <Skeleton className="mb-6 h-8 w-64" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} variant="card" />
            ))}
          </div>
          <div className="mt-6">
            <Skeleton variant="list" lines={4} />
          </div>
        </div>
      </main>
    </div>
  );
}
