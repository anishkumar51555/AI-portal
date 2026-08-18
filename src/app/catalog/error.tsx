"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";

/**
 * Error boundary for /catalog.
 *
 * The user is never shown `error.message` — it can carry a stack frame, a file
 * path, or a SQL fragment (rules/50). They get the `digest`, which is the id
 * Next logs the real error against server-side: quotable in a bug report,
 * useless to an attacker.
 */
export default function CatalogError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("catalog route error", { digest: error.digest });
  }, [error]);

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-16">
      <Card>
        <CardContent className="flex flex-col items-start gap-4 py-10">
          <div className="flex flex-col gap-2">
            <CardTitle className="text-lg">The catalog could not be loaded</CardTitle>
            <CardDescription>
              Something went wrong on our side. Your search is still in the address bar, so
              trying again will run the same query.
            </CardDescription>
          </div>

          {error.digest ? (
            <p className="text-muted-foreground text-xs">
              Reference: <code className="bg-muted rounded px-1">{error.digest}</code>
            </p>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <Button onClick={reset}>Try again</Button>
            {/* An escape hatch when the query itself is what breaks. */}
            <Button variant="outline" render={<Link href="/catalog" />}>
              Start over
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
