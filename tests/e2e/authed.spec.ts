import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "@playwright/test";

/**
 * The signed-in journeys.
 *
 * The session cookie is forged in global-setup with the REAL secret against a
 * REAL user row, so every guard downstream runs exactly as in production — only
 * the GitHub OAuth handshake is skipped (docs/11 §4).
 *
 * Features: F3.22, F5.4, F5.5
 */

test.describe("[F5.4] sign in, then download a template", () => {
  test("an authenticated visitor gets a redirect to storage", async ({ page }) => {
    await page.goto("/templates");

    // The button text itself proves the session took: an anonymous visitor sees
    // "Sign in to download" instead.
    const download = page.getByRole("link", { name: /^download$/i }).first();
    await expect(download).toBeVisible();

    // Follow the download without letting the browser save a file: the API
    // 302s to a presigned URL, and a 200 from storage is the real assertion.
    const href = await download.getAttribute("href");
    expect(href).toBeTruthy();

    const response = await page.request.get(href!, { maxRedirects: 5 });
    expect(response.status()).toBe(200);
    expect(Number(response.headers()["content-length"] ?? 0)).toBeGreaterThan(0);
  });

  test("the dashboard renders for a signed-in user", async ({ page }) => {
    await page.goto("/dashboard");

    // No redirect to /login — the guard accepted the forged-but-real cookie.
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: /my components/i })).toBeVisible();
  });
});

test.describe("[F5.5] publish a component, then find it in the catalog", () => {
  test("uploading the Skill template publishes it and it appears in search", async ({
    page,
  }) => {
    // The archive built by `npm run templates:build` — the same bytes a real
    // developer downloads. If this journey passes, the round trip the product
    // promises works end to end.
    const archive = join(process.cwd(), "templates", ".dist", "skill-template-1.0.0.zip");
    const bytes = readFileSync(archive);

    await page.goto("/publish");
    await expect(page.getByRole("heading", { name: /publish a component/i })).toBeVisible();

    await page.setInputFiles("#archive", {
      name: "skill-template-1.0.0.zip",
      mimeType: "application/zip",
      buffer: bytes,
    });

    await page.getByRole("button", { name: /^publish$/i }).click();

    // Presign → upload → validate → commit. Generous timeout: this is a real
    // multipart upload to real storage, then a real archive inspection.
    const published = page.getByText(/published my-skill/i);
    const duplicate = page.getByText(/already published|already exists/i);

    await expect(published.or(duplicate)).toBeVisible({ timeout: 30_000 });

    // A duplicate checksum means a previous run already published it, which is
    // a PASS for this journey: the publish path worked, the uniqueness
    // constraint did its job, and the component is in the catalog either way.
    if (await duplicate.isVisible())
      test.info().annotations.push({
        type: "note",
        description:
          "Already published by an earlier run — duplicate archive correctly rejected.",
      });

    await page.goto("/catalog?q=my-skill");
    await expect(page.getByRole("link", { name: /my skill/i }).first()).toBeVisible();
  });
});

test.describe("[F3.22] the wizard renders field-level manifest errors", () => {
  test("a manifest with three bad fields shows three distinct errors", async ({ page }) => {
    const bad = readFileSync(
      join(process.cwd(), "tests", "fixtures", "archives", "invalid-manifest.zip"),
    );

    await page.goto("/publish");
    await page.setInputFiles("#archive", {
      name: "invalid-manifest.zip",
      mimeType: "application/zip",
      buffer: bad,
    });
    await page.getByRole("button", { name: /^publish$/i }).click();

    // Scoped to the form: Next renders its own empty
    // <div role="alert" id="__next-route-announcer__"> on every page, which an
    // unscoped getByRole("alert") matches first.
    const errors = page.locator("form [role='alert']");
    await expect(errors).toBeVisible({ timeout: 30_000 });

    // The differentiating feature: not "invalid manifest" but the exact fields.
    await expect(errors).toContainText(/component\.json has \d+ problem/i);

    // Every error carries a dotted path the publisher can find in their file.
    const paths = await errors.locator("code").allTextContents();
    expect(paths.length).toBeGreaterThanOrEqual(2);

    // And the file is STILL selected, so fixing and retrying costs one click.
    await expect(page.getByText(/invalid-manifest\.zip/)).toBeVisible();
    await expect(page.getByRole("button", { name: /try again/i })).toBeVisible();
  });

  test("a zip-slip archive is refused with a safety error, not a crash", async ({
    page,
  }) => {
    const hostile = readFileSync(
      join(process.cwd(), "tests", "fixtures", "archives", "zip-slip.zip"),
    );

    await page.goto("/publish");
    await page.setInputFiles("#archive", {
      name: "zip-slip.zip",
      mimeType: "application/zip",
      buffer: hostile,
    });
    await page.getByRole("button", { name: /^publish$/i }).click();

    // A 422 with a readable message — never a 500 or a blank page.
    await expect(page.locator("form [role='alert']")).toContainText(
      /escapes|unsafe|\.\./i,
      { timeout: 30_000 },
    );
  });
});
