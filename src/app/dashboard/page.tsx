import type { Metadata } from "next";
import Link from "next/link";
import { requireAuth } from "@/server/auth/guards";
import { listMine, type MyComponent } from "@/server/services/component.service";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = { title: "My components" };

// Per-user and never cacheable (docs/01 §6).
export const dynamic = "force-dynamic";

/**
 * Dashboard — everything the signed-in user has published.
 *
 * `requireAuth()` on the first line is the actual security boundary. The
 * middleware redirect that sent an anonymous visitor to /login is only a
 * courtesy — this call is what makes a crafted request fail.
 *
 * Spec: docs/03-api-contract.md §3.13
 */
export default async function DashboardPage() {
  const user = await requireAuth();
  const components = await listMine(user.id);

  const totalDownloads = components.reduce((sum, c) => sum + c.downloadCount, 0);

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
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
        </div>
        <Button render={<Link href="/publish" />}>Publish a component</Button>
      </header>

      {components.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Stat label="Components" value={String(components.length)} />
            <Stat
              label="Versions"
              value={String(components.reduce((sum, c) => sum + c.versionCount, 0))}
            />
            <Stat label="Downloads" value={totalDownloads.toLocaleString()} />
          </dl>

          <ul className="flex flex-col gap-4">
            {components.map((component) => (
              <li key={component.slug}>
                <ComponentRow component={component} />
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-muted/40 flex flex-col gap-1 rounded-lg p-4">
      <dt className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        {label}
      </dt>
      <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

const STATUS_VARIANT: Record<string, "secondary" | "destructive" | "outline"> = {
  PUBLISHED: "secondary",
  DEPRECATED: "outline",
  SUSPENDED: "destructive",
};

function ComponentRow({ component }: { component: MyComponent }) {
  return (
    <Card className={component.isDeleted ? "opacity-60" : undefined}>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle className="text-lg">
              <Link
                href={`/components/${component.slug}`}
                className="underline-offset-4 hover:underline"
              >
                {component.displayName}
              </Link>
            </CardTitle>
            <CardDescription>{component.summary}</CardDescription>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Badge variant="secondary">{component.urlType}</Badge>
            {/* A deleted or suspended component still appears here — the owner
                needs to know what happened to it, not just find it gone. */}
            {component.isDeleted ? (
              <Badge variant="destructive">deleted</Badge>
            ) : component.status !== "PUBLISHED" ? (
              <Badge variant={STATUS_VARIANT[component.status] ?? "outline"}>
                {component.status.toLowerCase()}
              </Badge>
            ) : null}
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <dl className="text-muted-foreground flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <div className="flex gap-1">
            <dt className="sr-only">Latest version</dt>
            <dd>v{component.latestVersion ?? "—"}</dd>
          </div>
          <div className="flex gap-1">
            <dt className="sr-only">Versions</dt>
            <dd>
              {component.versionCount}{" "}
              {component.versionCount === 1 ? "version" : "versions"}
            </dd>
          </div>
          <div className="flex gap-1">
            <dt className="sr-only">Downloads</dt>
            <dd>
              {component.downloadCount.toLocaleString()}{" "}
              {component.downloadCount === 1 ? "download" : "downloads"}
            </dd>
          </div>
        </dl>

        {component.tags.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {component.tags.map((tag) => (
              <li key={tag.slug}>
                <Badge variant="outline" className="text-[10px]">
                  {tag.label}
                </Badge>
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}

function EmptyState() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Nothing published yet</CardTitle>
        <CardDescription>
          Start from a template, build against the{" "}
          <code className="bg-muted rounded px-1 py-0.5 text-xs">component.json</code> spec,
          and publish it back. Every upload is validated before it enters the catalog.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-3">
        <Button render={<Link href="/templates" />}>Browse templates</Button>
        <Button variant="outline" render={<Link href="/publish" />}>
          Publish a component
        </Button>
      </CardContent>
    </Card>
  );
}
