import Link from "next/link";
import { getSessionUser } from "@/server/auth/guards";
import { signOutAction } from "@/server/auth/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Site header — part of the app shell.
 *
 * It lives under src/app/_components/ rather than src/components/ on purpose:
 * it reads the session, and the dependency rule forbids src/components/ from
 * importing src/server/ (docs/01 section 4, enforced by eslint). Anything in
 * src/components/ takes its data as props; anything that FETCHES lives here.
 * The `_` prefix keeps Next from treating this folder as a route.
 *
 * Being a Server Component, it reads the session directly — no useEffect, no
 * /api/me round trip, no signed-out flicker on first paint.
 */
export async function SiteHeader() {
  const user = await getSessionUser();

  return (
    <header className="border-border/60 bg-background/80 sticky top-0 z-40 border-b backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-6">
        <Link href="/" className="font-semibold tracking-tight">
          AI Component Portal
        </Link>

        <nav
          aria-label="Main"
          className="text-muted-foreground hidden gap-5 text-sm sm:flex"
        >
          <Link href="/catalog" className="hover:text-foreground transition-colors">
            Catalog
          </Link>
          <Link href="/templates" className="hover:text-foreground transition-colors">
            Templates
          </Link>
        </nav>

        <div className="ml-auto flex items-center gap-3">
          {user ? <UserMenu user={user} /> : <SignInLink />}
        </div>
      </div>
    </header>
  );
}

function SignInLink() {
  // shadcn now builds on Base UI, not Radix: composition is `render={<El />}`,
  // not `asChild`. Same idea — render as a Link but keep the Button styling and
  // behaviour — different prop.
  return (
    <Button size="sm" render={<Link href="/login" />}>
      Sign in
    </Button>
  );
}

type SessionUser = NonNullable<Awaited<ReturnType<typeof getSessionUser>>>;

function UserMenu({ user }: { user: SessionUser }) {
  const label = user.githubLogin ?? user.name ?? "Account";
  const initials = (user.name ?? user.githubLogin ?? "?").slice(0, 2).toUpperCase();

  return (
    <DropdownMenu>
      {/* The trigger renders a real <button>: keyboard-reachable and announced
          by screen readers. A clickable <div> here would be a bug (rules/60). */}
      <DropdownMenuTrigger
        className="focus-visible:ring-ring flex items-center gap-2 rounded-full focus-visible:ring-2 focus-visible:outline-none"
        aria-label={`Account menu for ${label}`}
      >
        <Avatar className="size-8">
          {user.image ? <AvatarImage src={user.image} alt="" /> : null}
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col gap-1">
          <span className="truncate font-medium">{label}</span>
          <Badge variant="secondary" className="w-fit text-[10px]">
            {user.role}
          </Badge>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <DropdownMenuItem render={<Link href="/dashboard" />}>
          My components
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link href="/publish" />}>Publish</DropdownMenuItem>
        {user.role === "ADMIN" ? (
          <DropdownMenuItem render={<Link href="/admin" />}>Admin</DropdownMenuItem>
        ) : null}

        <DropdownMenuSeparator />

        {/* A form POST, not a link. Signing out is a state change and must not be
            triggerable by a link prefetch or a crawler following a GET. */}
        <form action={signOutAction}>
          <DropdownMenuItem
            render={<button type="submit" />}
            className="w-full cursor-default text-left"
          >
            Sign out
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
