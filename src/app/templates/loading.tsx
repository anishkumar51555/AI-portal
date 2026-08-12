import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading state for /templates.
 *
 * The skeletons mirror the real layout's dimensions — same grid, same card
 * anatomy, four of them because there are always exactly four templates. A
 * skeleton whose shape does not match what arrives causes a visible jump, which
 * is worse than no skeleton at all (rules/60).
 */
export default function TemplatesLoading() {
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-10 px-6 py-12">
      <header className="flex flex-col gap-3">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-5 w-full max-w-2xl" />
        <Skeleton className="h-5 w-2/3 max-w-md" />
      </header>

      <ol className="grid gap-4 sm:grid-cols-3" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <li key={i} className="bg-muted/40 flex flex-col gap-2 rounded-lg p-4">
            <Skeleton className="h-3 w-14" />
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-4 w-full" />
          </li>
        ))}
      </ol>

      <ul className="grid gap-6 sm:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <li key={i}>
            <Card className="h-full">
              <CardHeader className="gap-3">
                <div className="flex items-start justify-between gap-3">
                  <Skeleton className="h-6 w-40" />
                  <Skeleton className="h-5 w-20 shrink-0" />
                </div>
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-4/5" />
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-2">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="col-span-2 h-4 w-28" />
              </CardContent>
              <CardFooter className="gap-2">
                <Skeleton className="h-9 flex-1" />
                <Skeleton className="h-9 w-28" />
              </CardFooter>
            </Card>
          </li>
        ))}
      </ul>

      <span className="sr-only" role="status">
        Loading templates
      </span>
    </main>
  );
}
