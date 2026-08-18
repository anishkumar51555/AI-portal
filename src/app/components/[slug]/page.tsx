import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { slugParamSchema } from "@/domain/schemas/catalog";
import { getSessionUser } from "@/server/auth/guards";
import { getBySlug } from "@/server/services/component.service";
import { Markdown } from "@/components/features/catalog/markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { formatBytes } from "@/lib/format";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

/**
 * OG/title metadata from the component itself.
 *
 * Runs its own query; Next dedupes the two within a render, so this does not
 * double the database work.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const parsed = slugParamSchema.safeParse(await params);
  if (!parsed.success) return { title: "Not found" };

  const component = await getBySlug(parsed.data.slug, await getSessionUser());
  if (!component) return { title: "Not found" };

  return {
    title: component.displayName,
    description: component.summary,
    openGraph: { title: component.displayName, description: component.summary },
  };
}

/**
 * /components/[slug] — the detail page.
 *
 * A missing, suspended or soft-deleted component all render the SAME 404. That
 * is deliberate: distinguishing them would confirm which slugs exist and turn
 * the page into an enumeration oracle (rules/50).
 *
 * Spec: docs/03-api-contract.md §3.5
 * Features: F4.7, F4.8
 */
export default async function ComponentDetailPage({ params }: Props) {
  const parsed = slugParamSchema.safeParse(await params);
  if (!parsed.success) notFound();

  const viewer = await getSessionUser();
  const component = await getBySlug(parsed.data.slug, viewer);
  if (!component) notFound();

  const version = component.latestVersion;

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-12">
      <nav aria-label="Breadcrumb" className="text-muted-foreground text-sm">
        <Link href="/catalog" className="underline-offset-4 hover:underline">
          Catalog
        </Link>
        <span aria-hidden="true"> / </span>
        <span className="text-foreground">{component.displayName}</span>
      </nav>

      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-3xl font-semibold tracking-tight">
                {component.displayName}
              </h1>
              <Badge variant="secondary">{component.urlType}</Badge>
              {component.status !== "PUBLISHED" ? (
                <Badge
                  variant={component.status === "SUSPENDED" ? "destructive" : "outline"}
                >
                  {component.status.toLowerCase()}
                </Badge>
              ) : null}
            </div>
            <p className="text-muted-foreground max-w-2xl">{component.summary}</p>
          </div>

          {version ? (
            <Button render={<a href={version.downloadUrl} />}>
              Download v{version.version}
            </Button>
          ) : null}
        </div>

        <dl className="text-muted-foreground flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <div className="flex gap-1.5">
            <dt>By</dt>
            <dd className="text-foreground">{component.owner.githubLogin ?? "unknown"}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="sr-only">Downloads</dt>
            <dd>{component.downloadCount.toLocaleString()} downloads</dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="sr-only">Licence</dt>
            <dd>{component.license}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="sr-only">Versions</dt>
            <dd>
              {component.versionCount}{" "}
              {component.versionCount === 1 ? "version" : "versions"}
            </dd>
          </div>
        </dl>

        {component.tags.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {component.tags.map((tag) => (
              <li key={tag.slug}>
                {/* Each tag links back into a filtered catalog — the whole
                    point of tagging, and it costs one anchor. */}
                <Link href={`/catalog?tags=${tag.slug}`}>
                  <Badge variant="outline" className="hover:bg-muted cursor-pointer">
                    {tag.label}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </header>

      <Separator />

      <div className="grid gap-8 lg:grid-cols-[1fr_16rem]">
        <article aria-label="README" className="min-w-0">
          {component.readme ? (
            // The ONE place user markdown becomes HTML (rules/50).
            <Markdown>{component.readme}</Markdown>
          ) : (
            <p className="text-muted-foreground text-sm">This component ships no README.</p>
          )}
        </article>

        <aside className="flex flex-col gap-6">
          {version ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Latest version</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 text-sm">
                <Row label="Version" value={`v${version.version}`} />
                <Row label="Size" value={formatBytes(version.sizeBytes)} />
                <Row
                  label="Published"
                  value={new Date(version.createdAt).toISOString().slice(0, 10)}
                />
                <div className="flex flex-col gap-1">
                  <span className="text-muted-foreground text-xs">SHA-256</span>
                  {/* break-all, not truncate: a checksum you cannot copy in
                      full is a checksum you cannot verify with. */}
                  <code className="bg-muted rounded px-1 py-0.5 font-mono text-[10px] break-all">
                    {version.checksumSha256}
                  </code>
                </div>
                {version.changelog ? (
                  <div className="flex flex-col gap-1">
                    <span className="text-muted-foreground text-xs">Changelog</span>
                    <p className="text-sm">{version.changelog}</p>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {(component.homepage ?? component.repository) ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Links</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 text-sm">
                {component.homepage ? (
                  <ExternalLink href={component.homepage}>Homepage</ExternalLink>
                ) : null}
                {component.repository ? (
                  <ExternalLink href={component.repository}>Repository</ExternalLink>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {component.versions.length > 1 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Version history</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-2 text-sm">
                  {component.versions.map((v) => (
                    <li key={v.version} className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs">v{v.version}</span>
                      <span className="text-muted-foreground text-xs">
                        {new Date(v.createdAt).toISOString().slice(0, 10)}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </aside>
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

/**
 * The manifest schema already guarantees https, but `rel` is still set: these
 * URLs come from a third party, and handing them `window.opener` costs nothing
 * to prevent.
 */
function ExternalLink({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="underline underline-offset-4"
    >
      {children}
    </a>
  );
}
