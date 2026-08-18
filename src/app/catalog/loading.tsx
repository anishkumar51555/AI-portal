import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading state for /catalog.
 *
 * The skeleton mirrors the real layout — same sidebar width, same responsive
 * grid, same card anatomy — so nothing jumps when the results arrive. A
 * skeleton of the wrong shape is worse than none (rules/60).
 */
export default function CatalogLoading() {
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-3">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-5 w-full max-w-2xl" />
      </header>

      <Skeleton className="h-10 w-full" />

      <div className="grid gap-8 md:grid-cols-[13rem_1fr]">
        <div className="flex flex-col gap-6" aria-hidden="true">
          <Skeleton className="h-9 w-full" />
          <div className="flex flex-col gap-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-5 w-14 rounded-full" />
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-6">
          <Skeleton className="h-5 w-32" />
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <li key={i}>
                <Card className="h-full">
                  <CardHeader className="gap-3">
                    <div className="flex items-start justify-between gap-3">
                      <Skeleton className="h-5 w-32" />
                      <Skeleton className="h-5 w-16 shrink-0" />
                    </div>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-4">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-4/5" />
                    <div className="flex gap-1">
                      <Skeleton className="h-4 w-12" />
                      <Skeleton className="h-4 w-12" />
                    </div>
                    <div className="flex justify-between">
                      <Skeleton className="h-3 w-20" />
                      <Skeleton className="h-3 w-24" />
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <span className="sr-only" role="status">
        Loading catalog
      </span>
    </main>
  );
}
