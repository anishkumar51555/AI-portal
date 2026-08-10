import { test, expect } from "@playwright/test";

/**
 * Authentication journeys.
 *
 * These deliberately do NOT drive GitHub's real login screen. That would be
 * slow, rate-limited, require credentials in CI, and would be testing GitHub
 * rather than this application. Journeys needing a signed-in user inject a
 * seeded session cookie via storageState (docs/11 section 4).
 *
 * Everything in this file runs without a database: the middleware redirect and
 * the /login page never touch Postgres when there is no session cookie.
 *
 * Feature: F1.6
 */

test.describe("[F1.6] protected routes redirect anonymous visitors", () => {
  test("sends an anonymous visitor from /dashboard to /login with a callbackUrl", async ({
    page,
  }) => {
    await page.goto("/dashboard");

    await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fdashboard/);
    await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();
  });

  test("preserves the full path and query string in callbackUrl", async ({ page }) => {
    // A visitor deep-linked to a filtered view should land back on that exact
    // view after signing in, not on a bare dashboard.
    await page.goto("/dashboard?tab=drafts&page=2");

    const url = new URL(page.url());
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("callbackUrl")).toBe("/dashboard?tab=drafts&page=2");
  });
});

// Playwright has no `test.each` — enumerate explicitly.
for (const path of ["/publish", "/settings", "/admin"]) {
  test(`[F1.6] ${path} is gated for anonymous visitors`, async ({ page }) => {
    await page.goto(path);
    await expect(page).toHaveURL(
      new RegExp(`/login\\?callbackUrl=${encodeURIComponent(path)}`),
    );
  });
}

test.describe("[F1.6] public routes stay open", () => {
  test("the landing page renders without a session", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL("/");
    // The header offers sign-in rather than an account menu.
    await expect(page.getByRole("link", { name: /sign in/i })).toBeVisible();
  });

  test("the login page offers GitHub and nothing else", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("button", { name: /continue with github/i })).toBeVisible();
    // No password field: this project stores no passwords at all.
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
  });

  test("an OAuth failure is reported in readable language", async ({ page }) => {
    await page.goto("/login?error=AccessDenied");
    await expect(page.getByRole("alert")).toContainText(/cancelled|denied/i);
  });
});

test.describe("[F1.7] auth cookie flags", () => {
  test("auth cookies are httpOnly and SameSite=Lax", async ({ request }) => {
    // Verified against real Set-Cookie headers, not against the config object —
    // Auth.js decides these at runtime, so reading the config would prove nothing.
    const res = await request.get("/api/auth/csrf");
    expect(res.ok()).toBe(true);

    const raw = res.headersArray().filter((h) => h.name.toLowerCase() === "set-cookie");
    expect(raw.length, "expected Auth.js to set cookies").toBeGreaterThan(0);

    for (const { value } of raw) {
      expect(value, `missing HttpOnly: ${value}`).toMatch(/;\s*HttpOnly/i);
      // Lax, not Strict: Strict breaks the OAuth return redirect, while Lax
      // still blocks cross-site POST CSRF (docs/08 §2.1).
      expect(value, `missing SameSite=Lax: ${value}`).toMatch(/;\s*SameSite=Lax/i);
    }
  });

  test("the CSRF cookie is not readable from JavaScript", async ({ page }) => {
    await page.goto("/login");
    const visible = await page.evaluate(() => document.cookie);
    expect(visible).not.toContain("authjs.csrf-token");
  });

  // `Secure` is deliberately NOT asserted. Over http://localhost a Secure cookie
  // would never be sent, so Auth.js omits it; in production it switches to the
  // __Secure- prefixed name with Secure set. Asserting it here would either fail
  // locally or force us to weaken the check into something meaningless.
  // Production is covered by the pre-launch checklist in docs/08 §9.
});
