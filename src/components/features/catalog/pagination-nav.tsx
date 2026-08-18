import Link from "next/link";
import { Button } from "@/components/ui/button";
import { toQueryString } from "@/lib/catalog-url";

/**
 * Previous / next paging.
 *
 * Real `<a>` elements rather than buttons, so paging works without JavaScript,
 * middle-click opens a page in a new tab, and the links are crawlable.
 */
interface PaginationNavProps {
  page: number;
  totalPages: number;
  total: number;
  /** The current query, which each link rewrites the `page` of. */
  params: Record<string, string | string[] | undefined>;
}

function hrefForPage(params: PaginationNavProps["params"], page: number): string {
  const next = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (key === "page" || value === undefined) continue;
    if (Array.isArray(value)) for (const v of value) next.append(key, v);
    else next.set(key, value);
  }
  if (page > 1) next.set("page", String(page));

  return `/catalog${toQueryString(next)}`;
}

export function PaginationNav({ page, totalPages, total, params }: PaginationNavProps) {
  if (totalPages <= 1) return null;

  const hasPrevious = page > 1;
  const hasNext = page < totalPages;

  return (
    <nav
      aria-label="Pagination"
      className="flex items-center justify-between gap-4 border-t pt-6"
    >
      <p className="text-muted-foreground text-sm" aria-live="polite">
        Page {page} of {totalPages}{" "}
        <span className="hidden sm:inline">· {total.toLocaleString()} components</span>
      </p>

      <div className="flex gap-2">
        {/* Rendered as disabled spans rather than omitted, so the controls do
            not shift position between the first, middle and last pages. */}
        {hasPrevious ? (
          <Button
            variant="outline"
            size="sm"
            render={<Link href={hrefForPage(params, page - 1)} />}
          >
            Previous
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            Previous
          </Button>
        )}
        {hasNext ? (
          <Button
            variant="outline"
            size="sm"
            render={<Link href={hrefForPage(params, page + 1)} />}
          >
            Next
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            Next
          </Button>
        )}
      </div>
    </nav>
  );
}
