import Link from "next/link";
import Image from "next/image";
import type { CatalogItem } from "@/domain/schemas/catalog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * One catalog result.
 *
 * A Server Component — it renders data and links, holds no state, and so ships
 * no JavaScript. `h-full` plus a flex column keeps every card in a row the same
 * height whatever the summary length, which is what stops the grid jumping as
 * results change.
 *
 * NOTE the prop type comes from `domain/`, not from the service: a UI
 * component may not import from `server/` at all — not even a type. ESLint
 * enforces this, and it caught the first draft of this file (docs/01 §4).
 */

const TYPE_LABELS: Record<string, string> = {
  skill: "Skill",
  plugin: "Plugin",
  agent: "Agent",
  "mcp-gateway": "MCP Gateway",
};

export function ComponentCard({ item }: { item: CatalogItem }) {
  return (
    <Card className="flex h-full flex-col transition-shadow hover:shadow-md">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-base leading-snug">
            {/* The whole card is not a link: nesting the tag links inside would
                be invalid HTML and unusable by keyboard. The title is the
                single primary target. */}
            <Link
              href={`/components/${item.slug}`}
              className="underline-offset-4 hover:underline"
            >
              {item.displayName}
            </Link>
          </CardTitle>
          <Badge variant="secondary" className="shrink-0">
            {TYPE_LABELS[item.urlType] ?? item.urlType}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-4">
        <p className="text-muted-foreground line-clamp-3 flex-1 text-sm">{item.summary}</p>

        {item.tags.length > 0 ? (
          <ul className="flex flex-wrap gap-1">
            {item.tags.slice(0, 4).map((tag) => (
              <li key={tag}>
                <Badge variant="outline" className="text-[10px]">
                  {tag}
                </Badge>
              </li>
            ))}
            {item.tags.length > 4 ? (
              <li className="text-muted-foreground self-center text-[10px]">
                +{item.tags.length - 4}
              </li>
            ) : null}
          </ul>
        ) : null}

        <div className="text-muted-foreground flex items-center justify-between gap-2 text-xs">
          <span className="flex items-center gap-1.5">
            {item.owner.image ? (
              // Explicit width/height prevent the layout shift that a bare
              // <img> would cause as avatars load in (rules/60).
              <Image
                src={item.owner.image}
                alt=""
                width={16}
                height={16}
                className="rounded-full"
                unoptimized
              />
            ) : null}
            <span>{item.owner.githubLogin ?? "unknown"}</span>
          </span>
          <span className="flex items-center gap-3">
            {item.latestVersion ? <span>v{item.latestVersion}</span> : null}
            <span className="tabular-nums">
              {item.downloadCount.toLocaleString()}{" "}
              {item.downloadCount === 1 ? "download" : "downloads"}
            </span>
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
