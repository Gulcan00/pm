import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Workspace } from "@/components/Workspace";
import { initialData } from "@/lib/kanban";

const response = (data: unknown, ok = true) => ({ ok, json: async () => data });
const first = { id: 1, name: "First project", description: "First description", cardCount: 0, completedCount: 0 };
const second = { ...first, id: 2, name: "Second project", description: "Second description" };
const emptyBoard = { columns: initialData.columns.map((column) => ({ ...column, cardIds: [] })), cards: {} };
const mockFetch = vi.fn();
const onLogout = vi.fn();
const onAccountDeleted = vi.fn();
const show = () => render(<Workspace username="alice" onLogout={onLogout} onAccountDeleted={onAccountDeleted} logoutError="" />);

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset().mockResolvedValue(response(emptyBoard))
    .mockResolvedValueOnce(response([first, second]));
});
afterEach(() => vi.unstubAllGlobals());

it("loads and switches owned boards with independent assistant sessions", async () => {
  const user = userEvent.setup();
  show();
  expect(await screen.findByRole("heading", { name: first.name })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "AI assistant", exact: true }));
  await user.type(screen.getByLabelText("Message"), "Unsaved chat");
  await user.selectOptions(screen.getByLabelText("Board"), "2");
  expect(await screen.findByRole("heading", { name: second.name })).toBeInTheDocument();
  expect(mockFetch).toHaveBeenLastCalledWith("/api/boards/2", expect.any(Object));
  await user.click(screen.getByRole("button", { name: "AI assistant", exact: true }));
  expect(screen.getByLabelText("Message")).toHaveValue("");
});

it("creates and edits board details", async () => {
  const user = userEvent.setup();
  show();
  await screen.findByRole("heading", { name: first.name });
  await user.click(screen.getByRole("button", { name: "New board" }));
  await user.type(screen.getByLabelText("Board name"), "New project");
  await user.type(screen.getByLabelText("Description"), "Ship a release");
  const created = { ...second, id: 3, name: "New project", description: "Ship a release" };
  mockFetch.mockResolvedValueOnce(response(created));
  await user.click(screen.getByRole("button", { name: "Create board", exact: true }));
  expect(await screen.findByRole("heading", { name: "New project" })).toBeInTheDocument();
  expect(mockFetch).toHaveBeenCalledWith("/api/boards", expect.objectContaining({ method: "POST", body: JSON.stringify({ name: "New project", description: "Ship a release" }) }));
  await user.click(screen.getByRole("button", { name: "Board settings" }));
  await user.clear(screen.getByLabelText("Board name"));
  await user.type(screen.getByLabelText("Board name"), "Renamed project");
  mockFetch.mockResolvedValueOnce(response({ ...created, name: "Renamed project" }));
  await user.click(screen.getByRole("button", { name: "Save board" }));
  expect(await screen.findByRole("heading", { name: "Renamed project" })).toBeInTheDocument();
});

it("retains a failed board draft and allows cancellation", async () => {
  const user = userEvent.setup();
  show();
  await screen.findByRole("heading", { name: first.name });
  await user.click(screen.getByRole("button", { name: "New board" }));
  await user.type(screen.getByLabelText("Board name"), "Keep this");
  mockFetch.mockResolvedValueOnce(response({}, false));
  await user.click(screen.getByRole("button", { name: "Create board", exact: true }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Unable to save");
  expect(screen.getByLabelText("Board name")).toHaveValue("Keep this");
  await user.click(screen.getByRole("button", { name: "Cancel", exact: true }));
  expect(screen.queryByLabelText("Board name")).not.toBeInTheDocument();
});

it("requires confirmation to delete, handles errors, and switches to the remaining board", async () => {
  const user = userEvent.setup();
  show();
  await screen.findByRole("heading", { name: first.name });
  await user.click(screen.getByRole("button", { name: "Delete board", exact: true }));
  await user.click(screen.getByRole("button", { name: "Cancel", exact: true }));
  expect(screen.queryByLabelText("Confirm board deletion")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Delete board", exact: true }));
  mockFetch.mockRejectedValueOnce(new Error("offline"));
  await user.click(screen.getByRole("button", { name: "Confirm delete board" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Unable to delete");
  mockFetch.mockResolvedValueOnce(response(null));
  await user.click(screen.getByRole("button", { name: "Confirm delete board" }));
  expect(await screen.findByRole("heading", { name: second.name })).toBeInTheDocument();
  expect(screen.queryByRole("option", { name: first.name })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Delete board", exact: true }));
  mockFetch.mockResolvedValueOnce(response(null));
  await user.click(screen.getByRole("button", { name: "Confirm delete board" }));
  expect(await screen.findByText("Your next project starts here")).toBeInTheDocument();
});

it("recovers from a board list error", async () => {
  mockFetch.mockReset().mockResolvedValueOnce(response({}, false));
  const user = userEvent.setup();
  show();
  expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load");
  mockFetch.mockResolvedValueOnce(response([]));
  await user.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("Your next project starts here")).toBeInTheDocument();
});

it("opens and closes account settings", async () => {
  const user = userEvent.setup();
  show();
  await user.click(await screen.findByRole("button", { name: "Account settings" }));
  const settings = screen.getByRole("form", { name: "Account settings" });
  expect(within(settings).getByLabelText("Current password")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Close settings" }));
  expect(screen.queryByRole("form", { name: "Account settings" })).not.toBeInTheDocument();
});
