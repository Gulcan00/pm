import { expect, test, type Page } from "@playwright/test";

const password = "browser-test-password";

async function register(page: Page) {
  const username = `e2e_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await page.goto("/");
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByTestId("column-col-backlog")).toBeVisible();
  return username;
}

test("manages multiple boards and task metadata with reload persistence", async ({ page }) => {
  await register(page);
  await page.getByRole("button", { name: "New board", exact: true }).click();
  await page.getByLabel("Board name").fill("Product launch");
  await page.getByLabel("Description", { exact: true }).fill("Ship the new product");
  await page.getByRole("button", { name: "Create board", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Product launch" })).toBeVisible();
  const launchId = await page.getByLabel("Board", { exact: true }).inputValue();
  const backlog = page.getByTestId("column-col-backlog");
  await backlog.getByRole("button", { name: "Add a card" }).click();
  await backlog.getByPlaceholder("Card title").fill("Launch checklist");
  await backlog.getByPlaceholder("Details", { exact: true }).fill("Prepare release notes");
  await backlog.getByLabel("Priority", { exact: true }).selectOption("urgent");
  await backlog.getByLabel("Due date").fill("2020-01-01");
  await backlog.getByRole("button", { name: "Add card", exact: true }).click();
  const createdCard = page.locator('[data-testid^="card-"]').filter({ hasText: "Launch checklist" });
  await expect(createdCard).toBeVisible();
  const cardTestId = await createdCard.getAttribute("data-testid");
  if (!cardTestId) throw new Error("Created task has no stable ID");
  const card = page.getByTestId(cardTestId);
  await expect(card.getByText("urgent", { exact: true })).toBeVisible();
  await expect(card.getByText("Overdue:")).toBeVisible();
  await page.getByLabel("Search cards").fill("not here");
  await expect(card).toHaveCount(0);
  await page.getByLabel("Search cards").fill("release notes");
  await expect(card).toBeVisible();
  await page.getByLabel("Filter priority").selectOption("low");
  await expect(card).toHaveCount(0);
  await page.getByLabel("Filter priority").selectOption("urgent");
  await expect(card).toBeVisible();
  await page.getByLabel("Search cards").clear();
  await page.getByLabel("Filter priority").selectOption("all");

  await page.getByRole("button", { name: "Board settings", exact: true }).click();
  await page.getByLabel("Board name").fill("Launch v2");
  await page.getByRole("button", { name: "Save board" }).click();
  await expect(page.getByRole("heading", { name: "Launch v2" })).toBeVisible();
  await page.getByLabel("Board", { exact: true }).selectOption({ label: "My project" });
  await expect(page.getByRole("heading", { name: "My project" })).toBeVisible();
  await expect(card).toHaveCount(0);
  await page.reload();
  await page.getByLabel("Board", { exact: true }).selectOption(launchId);
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Edit Launch checklist" }).click();
  await expect(card.getByLabel("Due date")).toHaveValue("2020-01-01");
  await card.getByLabel("Due date").clear();
  await card.getByLabel("Priority").selectOption("high");
  await card.getByRole("button", { name: "Save", exact: true }).click();
  await expect(card.getByText("high", { exact: true })).toBeVisible();
  await expect(card.getByText("Overdue:")).toHaveCount(0);
  await card.getByLabel("Move Launch checklist to").selectOption("col-done");
  await expect(page.getByTestId("column-col-done").getByText("Launch checklist", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Project completion")).toHaveAttribute("value", "1");
  await page.getByRole("button", { name: "Delete board", exact: true }).click();
  await expect(page.getByText(/This cannot be undone/)).toBeVisible();
  await page.getByRole("button", { name: "Confirm delete board" }).click();
  await expect(page.getByRole("heading", { name: "My project" })).toBeVisible();
  await expect(page.getByRole("option", { name: "Launch v2" })).toHaveCount(0);
});

test("changes passwords, signs in again and deletes an account", async ({ page, browser }) => {
  const username = await register(page);
  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  try {
    await other.goto("/");
    await other.getByLabel("Username").fill(username);
    await other.getByLabel("Password", { exact: true }).fill(password);
    await other.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(other.getByTestId("column-col-backlog")).toBeVisible();
    await page.getByRole("button", { name: "Account settings", exact: true }).click();
    await page.getByLabel("Current password").fill(password);
    await page.getByLabel(/New password/).fill("a-new-browser-password");
    await page.getByRole("button", { name: "Change password", exact: true }).click();
    await expect(page.getByRole("form", { name: "Account settings" }).getByRole("status")).toContainText("Password changed");
    await other.reload();
    await expect(other.getByLabel("Username")).toBeVisible();
    await page.getByRole("button", { name: "Close settings" }).click();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.getByLabel("Username").fill(username);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText("Invalid username or password.", { exact: true })).toBeVisible();
    await page.getByLabel("Password", { exact: true }).fill("a-new-browser-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByTestId("column-col-backlog")).toBeVisible();
    await page.getByRole("button", { name: "Account settings", exact: true }).click();
    await page.getByRole("button", { name: "Delete account", exact: true }).click();
    await page.getByLabel("Current password").fill("a-new-browser-password");
    await page.getByRole("button", { name: "Confirm delete account" }).click();
    await expect(page.getByLabel("Username")).toBeVisible();
    await page.getByLabel("Username").fill(username);
    await page.getByLabel("Password", { exact: true }).fill("a-new-browser-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText("Invalid username or password.", { exact: true })).toBeVisible();
  } finally { await otherContext.close(); }
});

test("clears AI history on board switch and rejects another user's board through the API", async ({ page, browser }) => {
  await register(page);
  const boardsResponse = await page.request.get("/api/boards");
  const boards = (await boardsResponse.json()) as Array<{ id: number }>;
  await page.route("**/api/boards/*/ai/chat", (route) => route.fulfill({
    json: { assistant_text: "Only this board.", operations: [] },
  }));
  await page.getByRole("button", { name: "AI assistant", exact: true }).click();
  await page.getByLabel("Message").fill("Summarize");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("Only this board.")).toBeVisible();
  await page.getByRole("button", { name: "New board", exact: true }).click();
  await page.getByLabel("Board name").fill("Independent board");
  await page.getByRole("button", { name: "Create board", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Independent board" })).toBeVisible();
  await page.getByRole("button", { name: "AI assistant", exact: true }).click();
  await expect(page.getByText("No messages yet.")).toBeVisible();
  const outsider = await browser.newContext();
  try {
    const otherPage = await outsider.newPage();
    await register(otherPage);
    expect((await otherPage.request.get(`/api/boards/${boards[0].id}`)).status()).toBe(404);
    expect((await otherPage.request.delete(`/api/boards/${boards[0].id}`)).status()).toBe(404);
  } finally { await outsider.close(); }
});
