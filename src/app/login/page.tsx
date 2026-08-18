import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getSessionUser } from "@/server/auth/guards";
import { signInWithGitHub } from "@/server/auth/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in with GitHub to download and publish AI components.",
};

/** Auth.js reports failures via ?error= — translate the codes users can hit. */
const ERROR_MESSAGES: Record<string, string> = {
  AccessDenied: "You cancelled the GitHub sign-in, or access was denied.",
  Configuration: "Sign-in is misconfigured on the server. Please report this.",
  OAuthAccountNotLinked: "That email is already linked to a different sign-in method.",
  Verification: "That sign-in link has expired. Try again.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const params = await searchParams;

  // Already signed in? Nothing to do here.
  if (await getSessionUser()) redirect(params.callbackUrl ?? "/");

  // Same open-redirect guard as the action: only same-site relative paths.
  const callbackUrl =
    params.callbackUrl?.startsWith("/") && !params.callbackUrl.startsWith("//")
      ? params.callbackUrl
      : "/";

  const error = params.error
    ? (ERROR_MESSAGES[params.error] ?? "Sign-in failed. Please try again.")
    : null;

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-16">
      <Card className="w-full max-w-md">
        <CardHeader>
          {/* A real <h1>, not CardTitle: CardTitle renders a <div>, which would
              leave this page with no heading at all — a screen reader user
              lands with nothing to orient on (rules/60). */}
          <h1 className="text-2xl leading-none font-semibold">Sign in</h1>
          <CardDescription>
            Sign in with GitHub to download templates, publish components, and manage what
            you have shared.
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-5">
          {error ? (
            <p
              role="alert"
              className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm"
            >
              {error}
            </p>
          ) : null}

          <form action={signInWithGitHub}>
            <input type="hidden" name="callbackUrl" value={callbackUrl} />
            <Button type="submit" className="w-full" size="lg">
              <GitHubMark />
              Continue with GitHub
            </Button>
          </form>

          <p className="text-muted-foreground text-xs leading-relaxed">
            We only request your public profile and email. This portal stores no passwords —
            your GitHub identity is also what credits you as the publisher of anything you
            share.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}

function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}
