"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";

/**
 * Error boundary for /templates.
 *
 * `"use client"` is required — an error boundary needs `componentDidCatch`,
 * which only exists on the client.
 *
 * The user is never shown `error.message`: it can carry a stack frame, a file
 * path, or a database string (rules/50). They get the `digest` instead, which
 * is the id Next logs the real error against server-side — quotable in a bug
 * report, useless to an attacker.
 */
export default function TemplatesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Server-side errors are already logged with their digest; this covers the
    // client-render case, which otherwise leaves no trace anywhere.
    console.error("templates route error", { digest: error.digest });
  }, [error]);

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-16">
      <Card>
        <CardContent className="flex flex-col items-start gap-4 py-10">
          <div className="flex flex-col gap-2">
            <CardTitle className="text-lg">Templates could not be loaded</CardTitle>
            <CardDescription>
              Something went wrong on our side. The templates themselves are fine — try
              again in a moment.
            </CardDescription>
          </div>

          {error.digest ? (
            <p className="text-muted-foreground text-xs">
              Reference:{" "}
              <code className="bg-muted rounded px-1 py-0.5">{error.digest}</code>
            </p>
          ) : null}

          <Button onClick={reset}>Try again</Button>
        </CardContent>
      </Card>
    </main>
  );
}
