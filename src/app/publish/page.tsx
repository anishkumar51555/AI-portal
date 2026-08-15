import type { Metadata } from "next";
import Link from "next/link";
import { requireAuth } from "@/server/auth/guards";
import { PublishWizard } from "@/components/features/publish/publish-wizard";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Publish a component" };

// Per-user, and the wizard is interactive from the first paint.
export const dynamic = "force-dynamic";

/**
 * /publish — upload and publish a component.
 *
 * A Server Component that authorizes, then hands off to one client island.
 * `requireAuth()` on the first line is the real boundary; the middleware
 * redirect that sent an anonymous visitor to /login is only a courtesy.
 *
 * Spec: docs/04-sequence-flows.md Flow 3
 */
export default async function PublishPage() {
  await requireAuth();

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">Publish a component</h1>
        <p className="text-muted-foreground">
          Your archive is validated against the manifest specification before it enters the
          catalog. Nothing is published until it passes.
        </p>
      </header>

      <PublishWizard />

      <Card className="bg-muted/30">
        <CardContent className="flex flex-col gap-2 py-5">
          <CardTitle className="text-sm">The mistake almost everyone makes</CardTitle>
          <CardDescription>
            Zipping the <em>folder</em> instead of its <em>contents</em>. The manifest has
            to be at the archive root, not inside a subfolder — if you started from a{" "}
            <Link href="/templates" className="underline underline-offset-4">
              template
            </Link>
            , <code className="bg-muted rounded px-1">npm run pack</code> does it correctly.
          </CardDescription>
        </CardContent>
      </Card>
    </main>
  );
}
