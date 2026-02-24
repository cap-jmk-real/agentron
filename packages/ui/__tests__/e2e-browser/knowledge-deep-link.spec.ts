/**
 * Browser e2e: deep link /knowledge?tab=connectors opens Knowledge and shows Connectors tab.
 */
import { test, expect } from "@playwright/test";

test.describe("Knowledge deep link", () => {
  test("?tab=connectors opens Knowledge with Connectors tab active", async ({ page }) => {
    await page.goto("/knowledge?tab=connectors");
    await expect(page.getByRole("heading", { name: "Knowledge (RAG)", level: 1 })).toBeVisible();
    const connectorsButton = page.getByRole("button", { name: "Connectors" });
    await expect(connectorsButton).toBeVisible();
    await expect(connectorsButton).toHaveClass(/button-primary/);
    await expect(
      page.getByText("Sync external sources (Google Drive, Notion, local folders")
    ).toBeVisible();
  });
});
