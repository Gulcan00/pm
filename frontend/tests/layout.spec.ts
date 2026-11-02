import { expect, test } from "@playwright/test";
import { initialData } from "../src/lib/kanban";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ json: { username: "user" } })
  );
  await page.route("**/api/boards", (route) =>
    route.fulfill({ json: [{ id: 1, name: "Layout board", description: "", cardCount: 8, completedCount: 2 }] })
  );
  await page.route("**/api/boards/1", (route) =>
    route.fulfill({
      json: {
        ...initialData,
        cards: {
          ...initialData.cards,
          "card-1": {
            ...initialData.cards["card-1"],
            details: "LongUnbrokenContent".repeat(30),
          },
        },
      },
    })
  );
});

for (const width of [390, 768, 1440, 1920, 2560]) {
  test(`uses horizontal space without squeezing columns at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/");
    const board = page.getByRole("region", { name: "Kanban board" });
    const columns = page.locator('[data-testid^="column-"]');
    await expect(columns).toHaveCount(5);

    const boxes = await columns.evaluateAll((elements) =>
      elements.map((element) => {
        const { x, y, width, right } = element.getBoundingClientRect();
        return { x, y, width, right };
      })
    );
    expect(boxes.every((box) => box.width >= 260)).toBe(true);
    expect(boxes.every((box) => box.y === boxes[0].y)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);

    if (width >= 1440) {
      expect(boxes[0].x).toBe(32);
      expect(boxes[4].right).toBeCloseTo(width - 32, 0);
    } else {
      await board.focus();
      await page.keyboard.press("End");
      await page.getByTestId("column-col-done").scrollIntoViewIfNeeded();
      expect(await board.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    }

    await page.getByRole("button", { name: "AI assistant", exact: true }).click();
    const assistant = page.getByRole("complementary", { name: "AI assistant" });
    await expect(assistant).toBeVisible();
    const assistantBox = await assistant.boundingBox();
    const boardBox = await board.boundingBox();
    expect(assistantBox).not.toBeNull();
    expect(boardBox).not.toBeNull();
    if (width >= 1200) {
      expect(assistantBox!.width).toBe(320);
      expect(assistantBox!.x).toBeGreaterThanOrEqual(boardBox!.x + boardBox!.width);
      expect(assistantBox!.y).toBe(boardBox!.y);
    } else {
      expect(assistantBox!.y + assistantBox!.height).toBeLessThanOrEqual(boardBox!.y);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await assistant.getByRole("button", { name: "Close", exact: true }).click();
    await expect(assistant).toBeHidden();
  });
}

test("card icon controls leave the full card width for readable text", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  const card = page.getByTestId("card-card-1");
  const edit = card.getByRole("button", { name: "Edit Align roadmap themes", exact: true });
  const remove = card.getByRole("button", { name: "Delete Align roadmap themes", exact: true });
  await expect(edit).toHaveText("");
  await expect(remove).toHaveText("");
  await expect(edit.locator("svg")).toBeVisible();
  await expect(remove.locator("svg")).toBeVisible();
  const textBox = await card.getByRole("heading").boundingBox();
  const cardBox = await card.boundingBox();
  expect(textBox!.width).toBeGreaterThan(cardBox!.width - 40);
  for (const control of [edit, remove]) {
    const box = await control.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(36);
    expect(box!.height).toBeGreaterThanOrEqual(36);
    await control.focus();
    await expect(control).toBeFocused();
  }
  await edit.focus();
  await page.keyboard.press("Enter");
  await expect(card.getByLabel("Card title")).toHaveValue("Align roadmap themes");
  await card.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(edit).toBeVisible();
});
