import type { Metadata } from "next";
import { getSessionUser } from "@/server/auth/guards";
import { list } from "@/server/services/template.service";
import { TemplateCard } from "@/components/features/templates/template-card";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Templates",
  description:
    "Validated starter projects for Skills, Plugins, Agents, and MCP Gateways — each one a working component you can publish back.",
};

/**
 * /templates — the four starter templates.
 *
 * A Server Component with no `"use client"` anywhere in the tree: the page is
 * static data plus links, so it ships zero component JavaScript. The download
 * is a plain anchor to a route handler, which is what lets it work without it.
 *
 * The catalog is shown to everyone; only the download is gated (docs/07 §5).
 * Showing the cards is what makes a logged-out visitor understand the product.
 *
 * Spec: docs/07-template-catalog.md §5
 * Features: F2.12
 */

// Download counts change; the session decides which button renders.
export const dynamic = "force-dynamic";

const STEPS = [
  {
    n: 1,
    title: "Download a template",
    body: "A working project with a valid component.json and a passing test suite.",
  },
  {
    n: 2,
    title: "Build your component",
    body: "Replace the placeholder logic. Keep the manifest in step with what you ship.",
  },
  {
    n: 3,
    title: "Publish it back",
    body: "Upload the archive. It is validated server-side before it enters the catalog.",
  },
] as const;

export default async function TemplatesPage() {
  const [templates, user] = await Promise.all([list(), getSessionUser()]);

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-10 px-6 py-12">
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">Templates</h1>
        <p className="text-muted-foreground max-w-2xl">
          Each template is a real, working component — not a skeleton. Every one is
          validated against the same manifest specification your uploads will be, so a
          template that builds is a template that publishes.
        </p>
      </header>

      {/* The five-second explanation of the whole product. */}
      <ol className="grid gap-4 sm:grid-cols-3">
        {STEPS.map((step) => (
          <li key={step.n} className="bg-muted/40 flex flex-col gap-1 rounded-lg p-4">
            <span className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
              Step {step.n}
            </span>
            <span className="font-medium">{step.title}</span>
            <span className="text-muted-foreground text-sm">{step.body}</span>
          </li>
        ))}
      </ol>

      {templates.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col gap-2 py-10 text-center">
            <CardTitle className="text-lg">No templates published yet</CardTitle>
            <CardDescription>
              The catalog is seeded by the build. Run{" "}
              <code className="bg-muted rounded px-1 py-0.5 text-xs">
                npm run templates:build
              </code>{" "}
              then{" "}
              <code className="bg-muted rounded px-1 py-0.5 text-xs">npm run db:seed</code>.
            </CardDescription>
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-6 sm:grid-cols-2">
          {templates.map((template) => (
            <li key={template.type}>
              <TemplateCard template={template} isSignedIn={user !== null} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
