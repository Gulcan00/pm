import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthGate } from "@/components/AuthGate";
import { initialData, type BoardData } from "@/lib/kanban";

const mockFetch = vi.fn();
const emptyBoard: BoardData = {
  columns: initialData.columns.map(({ id, title }) => ({ id, title, cardIds: [] })),
  cards: {},
};
const boardResponse = { ok: true, json: async () => emptyBoard } as Response;

describe("AuthGate", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    mockFetch.mockReset();
  });

  it("shows the login form when there is no active session", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false } as Response);

    render(<AuthGate />);

    expect(await screen.findByLabelText("Username")).toBeInTheDocument();
    expect(screen.queryByTestId("column-col-backlog")).not.toBeInTheDocument();
  });

  it("shows the board after a successful login", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false } as Response)
      .mockResolvedValueOnce({ ok: true } as Response)
      .mockResolvedValueOnce(boardResponse);
    const user = userEvent.setup();

    render(<AuthGate />);
    await user.type(await screen.findByLabelText("Username"), "user");
    await user.type(screen.getByLabelText("Password"), "password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByTestId("column-col-backlog")).toBeInTheDocument();
  });

  it("returns to the login form after signing out", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false } as Response)
      .mockResolvedValueOnce({ ok: true } as Response)
      .mockResolvedValueOnce(boardResponse)
      .mockResolvedValueOnce({ ok: true } as Response);
    const user = userEvent.setup();

    render(<AuthGate />);
    await user.type(await screen.findByLabelText("Username"), "user");
    await user.type(screen.getByLabelText("Password"), "password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await user.click(await screen.findByRole("button", { name: "Sign out" }));

    expect(await screen.findByLabelText("Username")).toBeInTheDocument();
  });

  it("shows a visible error when signing out fails", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true } as Response)
      .mockResolvedValueOnce(boardResponse)
      .mockResolvedValueOnce({ ok: false } as Response);
    const user = userEvent.setup();

    render(<AuthGate />);
    await user.click(await screen.findByRole("button", { name: "Sign out" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to sign out. Check your connection and try again."
    );
  });
});