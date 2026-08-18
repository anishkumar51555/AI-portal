import Link from "next/link";
import { search } from "@/server/services/component.service";
import { toCriteria, catalogQuerySchema } from "@/domain/schemas/catalog";
import { ComponentCard } from "@/components/features/catalog/component-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";

// Featured components and totals change as people publish.
export const dynamic = "force-dynamic";

/**
 * The landing page.
 *
 * One job: communicate the product in five seconds. Hero, the three-step loop,
 * the four component types, then real components from the real catalog — a
 * landing page showing invented examples is the fastest way to lose trust.
 */
export default async function HomePage() {
  const featured = await search(
    toCriteria(catalogQuerySchema.parse({ sort: "downloads", pageSize: "3" })),
  );

  return (
    <main className="flex flex-col">
      <section className="mx-auto flex max-w-4xl flex-col items-center gap-6 px-6 py-20 text-center">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          The registry for AI components
        </h1>
        <p className="text-muted-foreground max-w-2xl text-lg">
          Skills, Plugins, Agents, and MCP Gateways — each one validated against a published
          manifest specification before it enters the catalog. Download a template, build
          against the spec, publish it back.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Button render={<Link href="/catalog" />}>Browse the catalog</Button>
          <Button variant="outline" render={<Link href="/templates" />}>
            Start from a template
          </Button>
        </div>
      </section>

      <section aria-label="How it works" className="bg-muted/30 border-y">
        <ol className="mx-auto grid max-w-5xl gap-6 px-6 py-14 sm:grid-cols-3">
          {STEPS.map((step) => (
            <li key={step.n} className="flex flex-col gap-2">
              <span className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                Step {step.n}
              </span>
              <h2 className="font-medium">{step.title}</h2>
              <p className="text-muted-foreground text-sm">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-label="Component types" className="mx-auto w-full max-w-5xl px-6 py-16">
        <h2 className="mb-8 text-2xl font-semibold tracking-tight">
          Four kinds of component
        </h2>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {TYPES.map((type) => (
            <li key={type.slug}>
              <Link href={`/catalog?type=${type.slug}`} className="block h-full">
                <Card className="hover:border-ring h-full transition-colors">
                  <CardContent className="flex flex-col gap-2 py-6">
                    <CardTitle className="text-base">{type.label}</CardTitle>
                    <CardDescription>{type.body}</CardDescription>
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {featured.data.length > 0 ? (
        <section aria-label="Popular components" className="bg-muted/30 border-t">
          <div className="mx-auto w-full max-w-5xl px-6 py-16">
            <div className="mb-8 flex items-end justify-between gap-4">
              <h2 className="text-2xl font-semibold tracking-tight">Most downloaded</h2>
              <Link href="/catalog" className="text-sm underline underline-offset-4">
                See all {featured.pagination.total}
              </Link>
            </div>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {featured.data.map((item) => (
                <li key={item.slug}>
                  <ComponentCard item={item} />
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      <section className="mx-auto flex max-w-3xl flex-col items-center gap-4 px-6 py-20 text-center">
        <h2 className="text-2xl font-semibold tracking-tight">
          Every upload is validated before it enters
        </h2>
        <p className="text-muted-foreground">
          Archives are checked for path traversal, decompression bombs, symlinks and entry
          floods. Manifests are parsed against a strict schema and scanned for credentials.
          A component that publishes is a component that works.
        </p>
        <Button render={<Link href="/publish" />}>Publish a component</Button>
      </section>
    </main>
  );
}

const STEPS = [
  {
    n: 1,
    title: "Download a template",
    body: "A working project with a valid component.json and a passing test suite — not a skeleton.",
  },
  {
    n: 2,
    title: "Build your component",
    body: "Replace the placeholder logic. Keep the manifest in step with what you ship.",
  },
  {
    n: 3,
    title: "Publish it back",
    body: "Upload the archive. If the manifest is wrong you get the exact field, not a generic error.",
  },
] as const;

const TYPES = [
  {
    slug: "skill",
    label: "Skills",
    body: "A single well-defined capability a model can invoke.",
  },
  {
    slug: "plugin",
    label: "Plugins",
    body: "Hooks and commands that extend an existing tool's behaviour.",
  },
  {
    slug: "agent",
    label: "Agents",
    body: "Autonomous multi-step work with tools and an iteration budget.",
  },
  {
    slug: "mcp-gateway",
    label: "MCP Gateways",
    body: "An existing system exposed over the Model Context Protocol.",
  },
] as const;
