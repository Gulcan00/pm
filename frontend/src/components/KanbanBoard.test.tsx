import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KanbanBoard } from "@/components/KanbanBoard";
import { KanbanColumn } from "@/components/KanbanColumn";
import { initialData, type BoardData } from "@/lib/kanban";

const emptyBoard: BoardData = {
  columns: initialData.columns.map(({ id, title }) => ({ id, title, cardIds: [] })),
  cards: {},
};

const boardResponse = (board: BoardData, ok = true) =>
  ({ ok, json: async () => board }) as Response;

const boardWithCard = (
  id: string,
  title: string,
  details: string,
  columnId: string
): BoardData => ({
  columns: emptyBoard.columns.map((column) => ({
    ...column,
    cardIds: column.id === columnId ? [id] : [],
  })),
  cards: { [id]: { id, title, details } },
});

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
  mockFetch.mockResolvedValue(boardResponse(emptyBoard));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("KanbanBoard", () => {
  it("loads and renders five columns", async () => {
    render(<KanbanBoard />);
    expect(await screen.findAllByTestId(/column-/i)).toHaveLength(5);
  });

  it("renames a column", async () => {
    const renamedBoard: BoardData = {
      ...emptyBoard,
      columns: emptyBoard.columns.map((column, index) =>
        index === 0 ? { ...column, title: "New Name" } : column
      ),
    };
    mockFetch
      .mockReset()
      .mockResolvedValueOnce(boardResponse(emptyBoard))
      .mockResolvedValueOnce(boardResponse(renamedBoard));
    render(<KanbanBoard />);
    const column = await screen.findAllByTestId(/column-/i).then((columns) => columns[0]);
    const input = within(column).getByLabelText("Column title");
    await userEvent.clear(input);
    await userEvent.type(input, "New Name");
    await userEvent.keyboard("{Enter}");

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    expect(mockFetch.mock.calls[1][0]).toBe("/api/board/columns/col-backlog");
    expect(mockFetch.mock.calls[1][1]).toMatchObject({
      method: "PATCH",
      body: JSON.stringify({ title: "New Name" }),
    });
    expect(input).toHaveValue("New Name");
  });

  it("updates the title draft when the board changes it externally", () => {
    const column = emptyBoard.columns[0];
    const onRename = vi.fn().mockResolvedValue(true);
    const view = render(
      <KanbanColumn
        column={column}
        cards={[]}
        onRename={onRename}
        onAddCard={vi.fn().mockResolvedValue(true)}
        onDeleteCard={vi.fn().mockResolvedValue(true)}
        onEditCard={vi.fn().mockResolvedValue(true)}
        isSaving={false}
      />
    );

    view.rerender(
      <KanbanColumn
        column={{ ...column, title: "Renamed by assistant" }}
        cards={[]}
        onRename={onRename}
        onAddCard={vi.fn().mockResolvedValue(true)}
        onDeleteCard={vi.fn().mockResolvedValue(true)}
        onEditCard={vi.fn().mockResolvedValue(true)}
        isSaving={false}
      />
    );

    expect(screen.getByLabelText("Column title")).toHaveValue("Renamed by assistant");
  });

  it("adds and removes a card through the API", async () => {
    const withCard = boardWithCard("card-api-1", "New card", "Notes", "col-backlog");
    mockFetch
      .mockReset()
      .mockResolvedValueOnce(boardResponse(emptyBoard))
      .mockResolvedValueOnce(boardResponse(withCard))
      .mockResolvedValueOnce(boardResponse(emptyBoard));
    render(<KanbanBoard />);
    const column = await screen.findAllByTestId(/column-/i).then((columns) => columns[0]);
    const addButton = within(column).getByRole("button", {
      name: /add a card/i,
    });
    await userEvent.click(addButton);

    const titleInput = within(column).getByPlaceholderText(/card title/i);
    await userEvent.type(titleInput, "New card");
    const detailsInput = within(column).getByPlaceholderText(/details/i);
    await userEvent.type(detailsInput, "Notes");

    await userEvent.click(within(column).getByRole("button", { name: /add card/i }));

    expect(within(column).getByText("New card")).toBeInTheDocument();

    const deleteButton = within(column).getByRole("button", {
      name: /delete new card/i,
    });
    await userEvent.click(deleteButton);

    expect(within(column).queryByText("New card")).not.toBeInTheDocument();
    expect(mockFetch.mock.calls[1][0]).toBe("/api/board/cards");
    expect(mockFetch.mock.calls[2][0]).toBe("/api/board/cards/card-api-1");
  });

  it("keeps an unsaved card draft after a save error", async () => {
    mockFetch
      .mockReset()
      .mockResolvedValueOnce(boardResponse(emptyBoard))
      .mockResolvedValueOnce(boardResponse(emptyBoard, false));
    render(<KanbanBoard />);
    const column = await screen.findAllByTestId(/column-/i).then((columns) => columns[0]);
    await userEvent.click(
      within(column).getByRole("button", { name: /add a card/i })
    );
    const titleInput = within(column).getByPlaceholderText("Card title");
    await userEvent.type(titleInput, "Keep this draft");
    await userEvent.click(within(column).getByRole("button", { name: /add card/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to save changes");
    expect(titleInput).toHaveValue("Keep this draft");
  });

  it("retries a failed board load", async () => {
    mockFetch
      .mockReset()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(boardResponse(emptyBoard));
    render(<KanbanBoard />);

    await userEvent.click(await screen.findByRole("button", { name: "Retry" }));

    expect(await screen.findAllByTestId(/column-/i)).toHaveLength(5);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
