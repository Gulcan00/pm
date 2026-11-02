import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AccountSettings } from "@/components/AccountSettings";

const mockFetch = vi.fn();
const onDeleted = vi.fn();
const show = () => render(<AccountSettings username="alice" onDeleted={onDeleted} onClose={vi.fn()} />);
beforeEach(() => { vi.stubGlobal("fetch", mockFetch); mockFetch.mockReset(); onDeleted.mockReset(); });
afterEach(() => vi.unstubAllGlobals());

it("changes the password and clears sensitive form fields", async () => {
  mockFetch.mockResolvedValue({ ok: true });
  const user = userEvent.setup();
  show();
  await user.type(screen.getByLabelText("Current password"), "a-strong-password");
  await user.type(screen.getByLabelText(/New password/), "replacement-password");
  await user.click(screen.getByRole("button", { name: "Change password" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Other sessions have been signed out");
  expect(screen.getByLabelText("Current password")).toHaveValue("");
  expect(screen.getByLabelText(/New password/)).toHaveValue("");
  expect(mockFetch).toHaveBeenCalledWith("/api/auth/password", expect.objectContaining({
    method: "POST", body: JSON.stringify({ current_password: "a-strong-password", new_password: "replacement-password" }),
  }));
});

it.each([
  [403, "Current password is incorrect."],
  [429, "Too many account attempts."],
  [500, "Unable to update your account."],
])("handles password update status %s without dropping the draft", async (status, error) => {
  mockFetch.mockResolvedValue({ ok: false, status });
  const user = userEvent.setup();
  show();
  await user.type(screen.getByLabelText("Current password"), "a-strong-password");
  await user.type(screen.getByLabelText(/New password/), "replacement-password");
  await user.click(screen.getByRole("button", { name: "Change password" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(error);
  expect(screen.getByLabelText(/New password/)).toHaveValue("replacement-password");
});

it("requires password confirmation to delete the account and allows cancellation", async () => {
  mockFetch.mockResolvedValue({ ok: true });
  const user = userEvent.setup();
  show();
  await user.click(screen.getByRole("button", { name: "Delete account", exact: true }));
  expect(screen.queryByLabelText(/New password/)).not.toBeInTheDocument();
  expect(screen.getByText(/Permanently delete/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Cancel deletion" }));
  expect(screen.getByLabelText(/New password/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Delete account", exact: true }));
  await user.type(screen.getByLabelText("Current password"), "a-strong-password");
  await user.click(screen.getByRole("button", { name: "Confirm delete account" }));
  expect(onDeleted).toHaveBeenCalledOnce();
  expect(mockFetch).toHaveBeenCalledWith("/api/auth/account", expect.objectContaining({
    method: "DELETE", body: JSON.stringify({ username: "alice", password: "a-strong-password" }),
  }));
});

it("reports network errors", async () => {
  mockFetch.mockRejectedValue(new Error("offline"));
  const user = userEvent.setup();
  show();
  await user.click(screen.getByRole("button", { name: "Delete account", exact: true }));
  await user.type(screen.getByLabelText("Current password"), "password");
  await user.click(screen.getByRole("button", { name: "Confirm delete account" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("offline");
  expect(onDeleted).not.toHaveBeenCalled();
});
