"use server";

import { signIn, signOut } from "./config";

/**
 * Sign-in / sign-out as Server Actions, so the buttons that trigger them can be
 * plain forms rather than Client Components.
 *
 * Note there is nothing to authorize here: signing in is by definition
 * unauthenticated, and signing out only ever affects the caller's own cookie.
 * Every OTHER Server Action in this project must call a guard on its first line
 * (.claude/rules/30-api-and-validation.md) — a Server Action is a public HTTP
 * endpoint, and being invoked from a form grants it nothing.
 */

export async function signInWithGitHub(formData: FormData) {
  const raw = formData.get("callbackUrl");

  // Only accept a same-site relative path. An attacker-supplied absolute URL
  // here would turn our sign-in flow into an open redirect: a victim signs in
  // on the real site and is bounced to a phishing clone.
  const callbackUrl =
    typeof raw === "string" && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";

  await signIn("github", { redirectTo: callbackUrl });
}

export async function signOutAction() {
  await signOut({ redirectTo: "/" });
}
