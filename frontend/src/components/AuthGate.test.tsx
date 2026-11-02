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
const identityResponse = { ok: true, json: async () => ({ id: 1, username: "user" }) } as Response;
const boardsResponse = { ok: true, json: async () => [{ id: 1, name: "My project", description: "", cardCount: 0, completedCount: 0 }] } as Response;

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
      .mockResolvedValueOnce(identityResponse)
      .mockResolvedValueOnce(boardsResponse)
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
      .mockResolvedValueOnce(identityResponse)
      .mockResolvedValueOnce(boardsResponse)
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
      .mockResolvedValueOnce(identityResponse)
      .mockResolvedValueOnce(boardsResponse)
      .mockResolvedValueOnce(boardResponse)
      .mockResolvedValueOnce({ ok: false } as Response);
    const user = userEvent.setup();

    render(<AuthGate />);
    await user.click(await screen.findByRole("button", { name: "Sign out" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to sign out. Check your connection and try again."
    );
  });

  it("registers an account and clears credentials after success", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false } as Response)
      .mockResolvedValueOnce(identityResponse)
      .mockResolvedValueOnce(boardsResponse)
      .mockResolvedValueOnce(boardResponse);
    const user = userEvent.setup();
    render(<AuthGate />);
    await user.click(await screen.findByRole("button", { name: "Create an account" }));
    await user.type(screen.getByLabelText("Username"), "newuser");
    await user.type(screen.getByLabelText("Password"), "a-strong-password");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByTestId("column-col-backlog")).toBeInTheDocument();
    expect(mockFetch.mock.calls[1][0]).toBe("/api/auth/register");
  });

  it.each([
    [409, "Username is already taken."],
    [422, "Use a valid username and a password of at least 12 characters."],
    [429, "Too many account attempts. Try again shortly."],
  ])("shows registration errors for status %s", async (status, message) => {
    mockFetch.mockResolvedValueOnce({ ok: false } as Response)
      .mockResolvedValueOnce({ ok: false, status } as Response);
    const user = userEvent.setup();
    render(<AuthGate />);
    await user.click(await screen.findByRole("button", { name: "Create an account" }));
    await user.type(screen.getByLabelText("Username"), "newuser");
    await user.type(screen.getByLabelText("Password"), "a-strong-password");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    await user.click(screen.getByRole("button", { name: "Back to sign in" }));
    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reports invalid login and network failure without dropping the username", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false } as Response)
      .mockResolvedValueOnce({ ok: false, status: 401 } as Response)
      .mockRejectedValueOnce(new Error("offline"));
    const user = userEvent.setup();
    render(<AuthGate />);
    await user.type(await screen.findByLabelText("Username"), "user");
    await user.type(screen.getByLabelText("Password"), "wrong");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid username or password.");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Check your connection");
    expect(screen.getByLabelText("Username")).toHaveValue("user");
  });

  it("allows login after session lookup fails", async () => {
    mockFetch.mockRejectedValueOnce(new Error("offline"));
    render(<AuthGate />);
    expect(await screen.findByLabelText("Username")).toBeInTheDocument();
  });

  it("returns to sign in when signing out an already revoked session", async () => {
    mockFetch.mockResolvedValueOnce(identityResponse)
      .mockResolvedValueOnce(boardsResponse)
      .mockResolvedValueOnce(boardResponse)
      .mockResolvedValueOnce({ ok: false, status: 401 } as Response);
    render(<AuthGate />);
    await userEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    expect(await screen.findByLabelText("Username")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});