import Link from "next/link";
import type { TemplateSummary } from "@/domain/schemas/template";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatBytes } from "@/lib/format";

/**
 * One template in the grid.
 *
 * A Server Component: it renders static data and holds no state. The only
 * interactive part is the download link, which is a plain anchor to a route
 * handler — no client JavaScript is needed for it to work.
 */

const TYPE_LABEL: Record<string, string> = {
  skill: "Skill",
  plugin: "Plugin",
  agent: "Agent",
  "mcp-gateway": "MCP Gateway",
};

interface TemplateCardProps {
  template: TemplateSummary;
  /** Anonymous visitors get a sign-in prompt instead of a download link. */
  isSignedIn: boolean;
}

export function TemplateCard({ template, isSignedIn }: TemplateCardProps) {
  const label = TYPE_LABEL[template.urlType] ?? template.urlType;

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-lg">{template.name}</CardTitle>
          <Badge variant="secondary" className="shrink-0">
            {label}
          </Badge>
        </div>
        <CardDescription>{template.description}</CardDescription>
      </CardHeader>

      <CardContent className="flex-1">
        <dl className="text-muted-foreground grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <div>
            <dt className="sr-only">Version</dt>
            <dd>v{template.version}</dd>
          </div>
          <div>
            <dt className="sr-only">Size</dt>
            <dd>{formatBytes(template.sizeBytes)}</dd>
          </div>
          <div className="col-span-2">
            <dt className="sr-only">Downloads</dt>
            <dd>
              {template.downloadCount.toLocaleString()}{" "}
              {template.downloadCount === 1 ? "download" : "downloads"}
            </dd>
          </div>
        </dl>
      </CardContent>

      {/*
        docs/07 §5 also specifies a "View spec" button linking to template.docsUrl
        (`/docs/{type}`). That route does not exist — nothing in the
        implementation plan builds a docs site, only `/api/docs` (Scalar) in task
        5.11 — so rendering it would ship a button that 404s. `docsUrl` stays in
        the API response because docs/03 §3.2 specifies it; the button returns
        when there is somewhere for it to point.
      */}
      <CardFooter>
        {isSignedIn ? (
          <Button render={<a href={template.downloadUrl} />} className="w-full">
            Download
          </Button>
        ) : (
          <Button
            render={
              <Link href={`/login?callbackUrl=${encodeURIComponent("/templates")}`} />
            }
            className="w-full"
          >
            Sign in to download
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
