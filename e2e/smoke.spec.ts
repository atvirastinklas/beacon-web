import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  // Only a display preference, not authentication or a persisted browser profile.
  await page.addInitScript(() => localStorage.setItem("beacon-language", "en"));
});

test("public entry point renders the Packets view", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("banner")).toBeVisible();
  await expect(page.getByRole("tab", { name: "Packets", exact: true })).toHaveAttribute("aria-selected", "true");
  const filters = page.getByRole("toolbar", { name: "Packet filters" });
  await expect(filters).toBeVisible();
  await expect(filters.getByRole("textbox")).toBeEditable();
  await expect(page.getByRole("tab", { name: "Nodes", exact: true })).toBeEnabled();
});

test("public Nodes deep link works without a login session", async ({ page }) => {
  await page.goto("/?tab=Nodes");

  await expect(page).toHaveURL(/\?tab=Nodes$/);
  await expect(page.getByRole("tab", { name: "Nodes", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("toolbar", { name: "Node filters" }).getByRole("textbox")).toBeEditable();

  await page.getByRole("tab", { name: "Packets", exact: true }).click();
  await expect(page).toHaveURL(/\?tab=Packets$/);
  await expect(page.getByRole("toolbar", { name: "Packet filters" })).toBeVisible();
});
