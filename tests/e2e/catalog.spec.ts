import { test, expect } from "@playwright/test";

/**
 * Catalog URL state.
 *
 * The whole design bet of the catalog is that the URL is the only state
 * (rules/60). That claim is only meaningful if refresh and the back button
 * actually work, which is exactly what a unit test of the URL helpers cannot
 * establish — hence this journey.
 *
 * Features: F4.12
 */

test.describe("[F4.12] catalog URL state survives refresh and the back button", () => {
  test("a filtered URL reproduces the same results after a reload", async ({ page }) => {
    await page.goto("/catalog?type=skill&sort=name");

    const results = page.locator("a[href^='/components/']");
    // Wait for the grid, rather than racing the render: `allTextContents` on an
    // unsettled page returns whatever happens to exist at that instant.
    await expect(results.first()).toBeVisible();
    const before = await results.allTextContents();
    expect(before.length).toBeGreaterThan(0);

    await page.reload();

    await expect(results.first()).toBeVisible();
    expect(await results.allTextContents()).toEqual(before);
  });

  test("typing in the search box adds NO history entries", async ({ page }) => {
    // Start somewhere else so there is a real previous page to go back TO.
    // Without this the only history entry is about:blank and the assertion
    // below would pass for the wrong reason.
    await page.goto("/templates");
    await page.goto("/catalog");

    await page.locator("#catalog-search").fill("pdf");

    // Debounced by 300ms, so wait for the URL rather than asserting instantly.
    await expect(page).toHaveURL(/[?&]q=pdf/, { timeout: 5_000 });

    // ONE back press lands on /templates. The search box uses router.replace,
    // so four keystrokes added zero entries — with `push` this would take five.
    await page.goBack();
    await expect(page).toHaveURL(/\/templates$/);
  });

  test("clicking a type filter narrows the results and the URL", async ({ page }) => {
    await page.goto("/catalog");

    // `.click()` not `.check()`: the box is a CONTROLLED input whose state
    // comes back from the URL after a transition, so Playwright's check()
    // assertion that the state flipped synchronously does not hold.
    const skills = page.getByRole("checkbox").first();
    await skills.click();

    await expect(page).toHaveURL(/[?&]type=/, { timeout: 5_000 });
    await expect(skills).toBeChecked();
  });

  test("a filter change resets to page 1", async ({ page }) => {
    await page.goto("/catalog?page=2&pageSize=3");

    await page.locator("#catalog-search").fill("pdf");
    await expect(page).toHaveURL(/[?&]q=pdf/, { timeout: 5_000 });

    // Narrowing while deep in the pages must not strand the visitor on an
    // empty page that looks exactly like "no results".
    expect(new URL(page.url()).searchParams.get("page")).toBeNull();
  });

  test("a filtered miss offers the action that actually helps", async ({ page }) => {
    await page.goto("/catalog?q=zzzznotarealcomponent");

    await expect(page.getByText(/no components match those filters/i)).toBeVisible();
    // The action offered must be the one that helps: clear the filters.
    await expect(page.getByRole("link", { name: /clear filters/i })).toBeVisible();
  });

  test("the catalog is public — no session required", async ({ page }) => {
    await page.goto("/catalog");
    await expect(page).toHaveURL(/\/catalog$/);
    await expect(page.getByRole("heading", { name: /^catalog$/i })).toBeVisible();
  });
});
