import type { Metadata } from "next";
import { requireAuth } from "@/server/auth/guards";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = { title: "My components" };

// Per-user and never cacheable (docs/01 section 6).
export const dynamic = "force-dynamic";

/**
 * Dashboard.
 *
 * `requireAuth()` on the first line is the actual security boundary. The
 * middleware redirect that sent an anonymous visitor to /login is only a
 * courtesy — this call is what makes a crafted request fail.
 *
 * The component list arrives in Phase 3, task 3.12.
 */
export default async function DashboardPage() {
  const user = await requireAuth();

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">My components</h1>
        <p className="text-muted-foreground">
          Signed in as{" "}
          <span className="text-foreground font-medium">
            {user.githubLogin ?? user.name ?? user.email}
          </span>{" "}
          <Badge variant="secondary" className="ml-1 align-middle text-[10px]">
            {user.role}
          </Badge>
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Nothing published yet</CardTitle>
          <CardDescription>
            Publishing arrives in Phase 3. Once it does, everything you share will be listed
            here with its versions and download counts.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          Start by downloading a template from the Templates page, build against the
          <code className="bg-muted mx-1 rounded px-1 py-0.5 text-xs">component.json</code>
          spec, and publish it back.
        </CardContent>
      </Card>
    </main>
  );
}
