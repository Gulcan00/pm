import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NewCardForm } from "@/components/NewCardForm";

it("creates cards with metadata, keeps failed drafts, and resets after success", async () => {
  const onAdd = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  const user = userEvent.setup();
  render(<NewCardForm onAdd={onAdd} isSaving={false} />);
  await user.click(screen.getByRole("button", { name: "Add a card" }));
  await user.type(screen.getByPlaceholderText("Card title"), " Launch ");
  await user.type(screen.getByPlaceholderText("Details"), " Notes ");
  await user.selectOptions(screen.getByLabelText("Priority"), "urgent");
  await user.type(screen.getByLabelText("Due date"), "2026-12-31");
  await user.click(screen.getByRole("button", { name: "Add card", exact: true }));
  expect(onAdd).toHaveBeenCalledWith("Launch", "Notes", { priority: "urgent", dueDate: "2026-12-31" });
  expect(screen.getByPlaceholderText("Card title")).toHaveValue(" Launch ");
  await user.click(screen.getByRole("button", { name: "Add card", exact: true }));
  expect(screen.queryByPlaceholderText("Card title")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Add a card" }));
  expect(screen.getByPlaceholderText("Card title")).toHaveValue("");
  expect(screen.getByLabelText("Priority")).toHaveValue("medium");
  expect(screen.getByLabelText("Due date")).toHaveValue("");
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByPlaceholderText("Card title")).not.toBeInTheDocument();
});
