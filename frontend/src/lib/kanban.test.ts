import { createId, isOverdue, matchesCard, moveCard, type Column } from "@/lib/kanban";

describe("moveCard", () => {
  const baseColumns: Column[] = [
    { id: "col-a", title: "A", cardIds: ["card-1", "card-2"] },
    { id: "col-b", title: "B", cardIds: ["card-3"] },
  ];

  it("reorders cards in the same column", () => {
    const result = moveCard(baseColumns, "card-2", "card-1");
    expect(result[0].cardIds).toEqual(["card-2", "card-1"]);
  });

  it("moves cards to another column", () => {
    const result = moveCard(baseColumns, "card-2", "card-3");
    expect(result[0].cardIds).toEqual(["card-1"]);
    expect(result[1].cardIds).toEqual(["card-2", "card-3"]);
  });

  it("drops cards to the end of a column", () => {
    const result = moveCard(baseColumns, "card-1", "col-b");
    expect(result[0].cardIds).toEqual(["card-2"]);
    expect(result[1].cardIds).toEqual(["card-3", "card-1"]);
  });

  it("drops to the end of the current column without mutating its input", () => {
    const result = moveCard(baseColumns, "card-1", "col-a");
    expect(result[0].cardIds).toEqual(["card-2", "card-1"]);
    expect(baseColumns[0].cardIds).toEqual(["card-1", "card-2"]);
  });

  it("leaves unknown or unchanged targets alone", () => {
    expect(moveCard(baseColumns, "unknown", "card-1")).toBe(baseColumns);
    expect(moveCard(baseColumns, "card-1", "unknown")).toBe(baseColumns);
    expect(moveCard(baseColumns, "card-1", "card-1")).toBe(baseColumns);
  });
});

it("matches titles/details case-insensitively and honors default priorities", () => {
  const card = { id: "1", title: "Launch", details: "Release notes" };
  expect(matchesCard(card, " RELEASE ", "medium")).toBe(true);
  expect(matchesCard(card, "launch", "high")).toBe(false);
  expect(matchesCard(card, "missing", "all")).toBe(false);
  expect(matchesCard({ ...card, priority: "urgent" }, "", "urgent")).toBe(true);
});

it("treats missing or today's due dates as not overdue", () => {
  expect(isOverdue(undefined, "2026-11-02")).toBe(false);
  expect(isOverdue(null, "2026-11-02")).toBe(false);
  expect(isOverdue("2026-11-02", "2026-11-02")).toBe(false);
  expect(isOverdue("2026-11-01", "2026-11-02")).toBe(true);
  expect(isOverdue("2026-11-03", "2026-11-02")).toBe(false);
  expect(createId("card")).toMatch(/^card-[a-z0-9]+$/);
});
