import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { catalogQuerySchema, toCriteria } from "@/domain/schemas/catalog";
import { getSessionUser } from "@/server/auth/guards";
import { search } from "@/server/services/component.service";
import { ComponentCard } from "@/components/features/catalog/component-card";
import { FilterSidebar } from "@/components/features/catalog/filter-sidebar";
import { PaginationNav } from "@/components/features/catalog/pagination-nav";
import { SearchBox } from "@/components/features/catalog/search-box";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Catalog",
  description:
    "Browse published Skills, Plugins, Agents, and MCP Gateways. Every component is validated against the manifest specification before it enters.",
};

// Results change as people publish, and an ADMIN sees more than anyone else.
export const dynamic = "force-dynamic";

/**
 * /catalog — search, filter, sort, paginate.
 *
 * A Server Component driven entirely by `searchParams`. Refreshing a filtered
 * URL reproduces the same results, the back button works, and the results
 * themselves are server-rendered — none of which needs a client state library
 * (rules/60).
 *
 * Only the three interactive leaves are client components. The grid is not.
 *
 * Spec: docs/04-sequence-flows.md Flow 4 · docs/03 §3.4
 * Features: F4.1–F4.7, F4.12
 */
export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  // Never throws — a stale bookmark degrades to page 1 rather than an error
  // page (rules/30).
  const query = catalogQuerySchema.parse(params);
  const user = await getSessionUser();
  const page = await search(toCriteria(query, user?.role === "ADMIN"));

  const isFiltered = Boolean(query.q ?? query.type?.length ?? query.tags?.length);

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">Catalog</h1>
        <p className="text-muted-foreground max-w-2xl">
          Every component here passed the same manifest validation your uploads will.
        </p>
      </header>

      {/* useSearchParams needs a Suspense boundary; without one the whole route
          opts out of static rendering with a build-time warning. */}
      <Suspense fallback={<div className="h-10" />}>
        <div className="flex gap-3">
          <SearchBox />
        </div>
      </Suspense>

      <div className="grid gap-8 md:grid-cols-[13rem_1fr]">
        <Suspense fallback={<div />}>
          <FilterSidebar types={page.facets.types} tags={page.facets.tags} />
        </Suspense>

        <section aria-label="Results" className="flex flex-col gap-6">
          <p className="text-muted-foreground text-sm" aria-live="polite">
            {page.pagination.total.toLocaleString()}{" "}
            {page.pagination.total === 1 ? "component" : "components"}
            {query.q ? ` matching “${query.q}”` : ""}
          </p>

          {page.data.length === 0 ? (
            <EmptyState isFiltered={isFiltered} />
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {page.data.map((item) => (
                <li key={item.slug}>
                  <ComponentCard item={item} />
                </li>
              ))}
            </ul>
          )}

          <PaginationNav
            page={page.pagination.page}
            totalPages={page.pagination.totalPages}
            total={page.pagination.total}
            params={params}
          />
        </section>
      </div>
    </main>
  );
}

/**
 * The empty state.
 *
 * Two distinct messages, because the two situations need different actions: a
 * filtered miss needs the filters cleared, an empty catalog needs someone to
 * publish something. A single "No results" would be useless in both (rules/60).
 */
function EmptyState({ isFiltered }: { isFiltered: boolean }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
        <CardTitle className="text-lg">
          {isFiltered ? "No components match those filters" : "The catalog is empty"}
        </CardTitle>
        <CardDescription className="max-w-md">
          {isFiltered
            ? "Try removing a filter or searching for something broader."
            : "Nothing has been published yet. Start from a template and publish the first one."}
        </CardDescription>
        <div className="mt-2 flex flex-wrap justify-center gap-3">
          {isFiltered ? (
            // A plain link, so it works even if the sidebar's JavaScript has
            // not hydrated yet.
            <Button render={<Link href="/catalog" />}>Clear filters</Button>
          ) : (
            <Button render={<Link href="/templates" />}>Browse templates</Button>
          )}
          <Button variant="outline" render={<Link href="/publish" />}>
            Publish a component
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
