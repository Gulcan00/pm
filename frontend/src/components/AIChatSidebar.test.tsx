import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AIChatSidebar } from "@/components/AIChatSidebar";
import { initialData, type BoardData } from "@/lib/kanban";

const emptyBoard: BoardData = {
  columns: initialData.columns.map(({ id, title }) => ({ id, title, cardIds: [] })),
  cards: {},
};

const boardResponse = (body: unknown, ok = true) =>
  ({ ok, json: async () => body }) as Response;

const mockFetch = vi.fn();
const onBoardChange = vi.fn();
const onClose = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
  onBoardChange.mockReset();
  onClose.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AIChatSidebar", () => {
  it("sends transient history and applies proposed changes only after approval", async () => {
    const boardWithCard: BoardData = {
      columns: emptyBoard.columns.map((column, index) =>
        index === 0 ? { ...column, cardIds: ["card-ai"] } : { ...column }
      ),
      cards: { "card-ai": { id: "card-ai", title: "AI task", details: "" } },
    };
    mockFetch
      .mockResolvedValueOnce(
        boardResponse({
          assistant_text: "I propose creating the task.",
          operations: [
            {
              type: "create_card",
              column_id: "col-backlog",
              title: "AI task",
              details: "",
            },
          ],
        })
      )
      .mockResolvedValueOnce(boardResponse(boardWithCard))
      .mockResolvedValueOnce(
        boardResponse({ assistant_text: "There is one task.", operations: [] })
      );
    const user = userEvent.setup();
    const view = render(
      <AIChatSidebar
        isOpen
        board={emptyBoard}
        onClose={onClose}
        onBoardChange={onBoardChange}
      />
    );

    await user.type(screen.getByLabelText("Message"), "Create a task");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("I propose creating the task.")).toBeInTheDocument();
    expect(screen.getByText("Create “AI task” in Backlog")).toBeInTheDocument();
    expect(onBoardChange).not.toHaveBeenCalled();
    expect(mockFetch.mock.calls[0][0]).toBe("/api/ai/chat");
    expect(mockFetch.mock.calls[0][1]).toMatchObject({
      method: "POST",
      credentials: "same-origin",
      body: JSON.stringify({ question: "Create a task", history: [] }),
    });
    await user.click(screen.getByRole("button", { name: "Apply changes" }));
    expect(await screen.findByText("Changes applied.")).toBeInTheDocument();
    expect(mockFetch.mock.calls[1][0]).toBe("/api/ai/apply");
    expect(onBoardChange).toHaveBeenCalledWith(boardWithCard);

    view.rerender(
      <AIChatSidebar
        isOpen={false}
        board={boardWithCard}
        onClose={onClose}
        onBoardChange={onBoardChange}
      />
    );
    view.rerender(
      <AIChatSidebar
        isOpen
        board={boardWithCard}
        onClose={onClose}
        onBoardChange={onBoardChange}
      />
    );
    expect(screen.getByText("I propose creating the task.")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Message"), "Summarize it");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("There is one task.")).toBeInTheDocument();
    expect(JSON.parse(mockFetch.mock.calls[2][1].body)).toEqual({
      question: "Summarize it",
      history: [
        { role: "user", content: "Create a task" },
        { role: "assistant", content: "I propose creating the task." },
        { role: "assistant", content: "Changes applied." },
      ],
    });
    expect(onBoardChange).toHaveBeenCalledTimes(1);
  });

  it("keeps the question available after a provider error", async () => {
    mockFetch
      .mockResolvedValueOnce(
        boardResponse({ detail: "OpenRouter is unavailable." }, false)
      )
      .mockResolvedValueOnce(
        boardResponse({ assistant_text: "Ready.", operations: [] })
      );
    const user = userEvent.setup();
    render(
      <AIChatSidebar
        isOpen
        board={emptyBoard}
        onClose={onClose}
        onBoardChange={onBoardChange}
      />
    );

    const input = screen.getByLabelText("Message");
    await user.type(input, "Try this again");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "OpenRouter is unavailable."
    );
    expect(input).toHaveValue("Try this again");

    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Ready.")).toBeInTheDocument();
    expect(input).toHaveValue("");
  });

  it("discards proposed changes without applying them", async () => {
    mockFetch.mockResolvedValueOnce(
      boardResponse({
        assistant_text: "I propose removing the card.",
        operations: [{ type: "delete_card", card_id: "card-1" }],
      })
    );
    const user = userEvent.setup();
    render(
      <AIChatSidebar
        isOpen
        board={emptyBoard}
        onClose={onClose}
        onBoardChange={onBoardChange}
      />
    );

    await user.type(screen.getByLabelText("Message"), "Remove this card");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await user.click(await screen.findByRole("button", { name: "Discard" }));

    expect(await screen.findByText("Changes discarded.")).toBeInTheDocument();
    expect(onBoardChange).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
