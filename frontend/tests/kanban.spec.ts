import { expect, test, type Page } from "@playwright/test";

const signIn = async (page: Page) => {
  await page.goto("/");
  await page.getByLabel("Username").fill("user");
  await page.getByLabel("Password").fill("password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("column-col-backlog")).toBeVisible();
};

test("requires sign in and supports sign out", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByLabel("Username")).toBeVisible();
  await page.getByLabel("Username").fill("user");
  await page.getByLabel("Password").fill("incorrect");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Invalid username or password.", { exact: true })).toBeVisible();
  await expect(page.getByTestId("column-col-backlog")).toHaveCount(0);

  await page.getByLabel("Password").fill("password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("column-col-backlog")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("column-col-backlog")).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByLabel("Username")).toBeVisible();
});

test("loads the kanban board", async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole("heading", { name: "Kanban Studio" })).toBeVisible();
  await expect(page.locator('[data-testid^="column-"]')).toHaveCount(5);
});

test("adds a card to a column", async ({ page }) => {
  await signIn(page);
  const firstColumn = page.locator('[data-testid^="column-"]').first();
  const title = `Playwright card ${Date.now()}`;
  const editedTitle = `${title} edited`;
  await firstColumn.getByRole("button", { name: /add a card/i }).click();
  await firstColumn.getByPlaceholder("Card title").fill(title);
  await firstColumn.getByPlaceholder("Details").fill("Added via e2e.");
  await firstColumn.getByRole("button", { name: /add card/i }).click();
  await expect(firstColumn.getByText(title)).toBeVisible();

  const cardByTitle = page.locator('[data-testid^="card-"]').filter({ hasText: title });
  const cardTestId = await cardByTitle.getAttribute("data-testid");
  if (!cardTestId) {
    throw new Error("Unable to resolve the created card.");
  }
  const card = page.getByTestId(cardTestId);
  await card.getByRole("button", { name: `Edit ${title}` }).click();
  await card.getByRole("textbox", { name: "Card title" }).fill(editedTitle);
  await card.getByRole("textbox", { name: "Card details" }).fill("Edited via e2e.");
  await card.getByRole("button", { name: "Save" }).click();
  await expect(card.getByText(editedTitle)).toBeVisible();
  await card.getByRole("button", { name: `Edit ${editedTitle}` }).click();
  await expect(card.getByRole("textbox", { name: "Card title" })).toHaveValue(editedTitle);
  await card.getByRole("button", { name: "Cancel" }).click();

  await page.reload();
  const savedCard = page.locator('[data-testid^="card-"]').filter({ hasText: editedTitle });
  await expect(savedCard).toBeVisible();
  await savedCard.getByRole("button", { name: `Delete ${editedTitle}` }).click();
  await expect(savedCard).toHaveCount(0);
});

test("renames a fixed column and persists the title", async ({ page }) => {
  await signIn(page);
  const input = page.getByTestId("column-col-backlog").getByLabel("Column title");
  const originalTitle = await input.inputValue();
  await input.fill("Backlog E2E");
  await input.press("Enter");
  await expect(input).toHaveValue("Backlog E2E");

  await page.reload();
  const reloadedInput = page.getByTestId("column-col-backlog").getByLabel("Column title");
  await expect(reloadedInput).toHaveValue("Backlog E2E");
  await reloadedInput.fill(originalTitle);
  await reloadedInput.press("Enter");
  await expect(reloadedInput).toHaveValue(originalTitle);
});

test("moves a card between columns", async ({ page }) => {
  await signIn(page);
  const title = `Move card ${Date.now()}`;
  const sourceColumn = page.getByTestId("column-col-backlog");
  await sourceColumn.getByRole("button", { name: /add a card/i }).click();
  await sourceColumn.getByPlaceholder("Card title").fill(title);
  await sourceColumn.getByRole("button", { name: /add card/i }).click();
  const card = page.locator('[data-testid^="card-"]').filter({ hasText: title });
  const targetColumn = page.getByTestId("column-col-review");
  const cardBox = await card.boundingBox();
  const columnBox = await targetColumn.boundingBox();
  if (!cardBox || !columnBox) {
    throw new Error("Unable to resolve drag coordinates.");
  }

  await page.mouse.move(
    cardBox.x + cardBox.width / 2,
    cardBox.y + cardBox.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(
    columnBox.x + columnBox.width / 2,
    columnBox.y + 120,
    { steps: 12 }
  );
  await page.mouse.up();
  await expect(targetColumn.getByText(title)).toBeVisible();
  await page.reload();
  const persistedCard = page.locator('[data-testid^="card-"]').filter({ hasText: title });
  await expect(page.getByTestId("column-col-review").getByText(title)).toBeVisible();
  await persistedCard.getByRole("button", { name: `Delete ${title}` }).click();
  await expect(persistedCard).toHaveCount(0);
});

test("AI chat applies board updates and clears history at session boundaries", async ({ page }) => {
  const requests: Array<{ question: string; history: unknown[] }> = [];
  const assistantBoard = {
    columns: [
      { id: "col-backlog", title: "Backlog", cardIds: ["card-ai-test"] },
      { id: "col-discovery", title: "Discovery", cardIds: [] },
      { id: "col-progress", title: "In Progress", cardIds: [] },
      { id: "col-review", title: "Review", cardIds: [] },
      { id: "col-done", title: "Done", cardIds: [] },
    ],
    cards: {
      "card-ai-test": {
        id: "card-ai-test",
        title: "AI-created task",
        details: "Visible immediately.",
      },
    },
  };
  await page.route("**/api/ai/apply", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(assistantBoard),
    });
  });
  await page.route("**/api/ai/chat", async (route) => {
    const request = route.request().postDataJSON() as {
      question: string;
      history: unknown[];
    };
    requests.push(request);
    const result =
      request.question === "Create a task"
        ? {
            assistant_text: "I propose creating a task.",
            operations: [
              {
                type: "create_card",
                column_id: "col-backlog",
                title: "AI-created task",
                details: "Visible immediately.",
              },
            ],
          }
        : { assistant_text: "No board changes needed.", operations: [] };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(result),
    });
  });

  await signIn(page);
  await page.getByRole("button", { name: "AI assistant" }).click();
  await page.getByLabel("Message").fill("Create a task");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("I propose creating a task.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply changes" })).toBeVisible();
  await page.getByRole("button", { name: "Apply changes" }).click();
  await expect(page.getByText("Changes applied.")).toBeVisible();
  await expect(page.getByTestId("card-card-ai-test")).toBeVisible();

  await page.getByLabel("Message").fill("Summarize it");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("No board changes needed.")).toBeVisible();
  expect(requests[1].history).toEqual([
    { role: "user", content: "Create a task" },
    { role: "assistant", content: "I propose creating a task." },
    { role: "assistant", content: "Changes applied." },
  ]);

  await page.reload();
  await page.getByRole("button", { name: "AI assistant" }).click();
  await expect(page.getByText("No messages yet.")).toBeVisible();
  await expect(page.getByText("I propose creating a task.")).toHaveCount(0);
  await page.getByLabel("Message").fill("After reload");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("No board changes needed.")).toHaveCount(1);
  expect(requests[2].history).toEqual([]);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByLabel("Username")).toBeVisible();
  await page.getByLabel("Username").fill("user");
  await page.getByLabel("Password").fill("password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("column-col-backlog")).toBeVisible();
  await page.getByRole("button", { name: "AI assistant" }).click();
  await expect(page.getByText("No messages yet.")).toBeVisible();
  await expect(page.getByText("No board changes needed.")).toHaveCount(0);
});

test("AI chat recovers from provider failure without losing the prompt", async ({ page }) => {
  let requestCount = 0;
  await page.route("**/api/ai/chat", async (route) => {
    requestCount += 1;
    if (requestCount === 1) {
      await route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({ detail: "OpenRouter is unavailable." }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ assistant_text: "Recovered." }),
    });
  });

  await signIn(page);
  await page.getByRole("button", { name: "AI assistant" }).click();
  const input = page.getByLabel("Message");
  await input.fill("Keep this question");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText("OpenRouter is unavailable.", { exact: true })).toBeVisible();
  await expect(input).toHaveValue("Keep this question");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Recovered.")).toBeVisible();
  await expect(input).toHaveValue("");
  expect(requestCount).toBe(2);
});
