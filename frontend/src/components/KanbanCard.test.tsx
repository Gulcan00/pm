import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KanbanCard } from "@/components/KanbanCard";

const card = { id: "card-1", title: "Readable task", details: "Full-width details" };

it("provides named icon controls and saves edits", async () => {
  const onEdit = vi.fn().mockResolvedValue(true);
  const onDelete = vi.fn().mockResolvedValue(true);
  render(<KanbanCard card={card} onEdit={onEdit} onDelete={onDelete} isSaving={false} />);
  const edit = screen.getByRole("button", { name: "Edit Readable task" });
  const remove = screen.getByRole("button", { name: "Delete Readable task" });
  expect(edit).toHaveTextContent("");
  expect(edit.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  expect(remove).toHaveTextContent("");

  await userEvent.click(edit);
  expect(screen.getByTestId("card-card-1")).not.toHaveAttribute("aria-disabled");
  await userEvent.clear(screen.getByLabelText("Card title"));
  await userEvent.type(screen.getByLabelText("Card title"), "Updated task");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(onEdit).toHaveBeenCalledWith("card-1", "Updated task", card.details, { priority: "medium", dueDate: null });
  await userEvent.click(screen.getByRole("button", { name: "Delete Readable task" }));
  expect(onDelete).toHaveBeenCalledWith("card-1");
});

it("does not start dragging when using a card action", () => {
  const onPointerDown = vi.fn();
  render(
    <div onPointerDown={onPointerDown}>
      <KanbanCard card={card} onEdit={vi.fn()} onDelete={vi.fn()} isSaving={false} />
    </div>
  );
  fireEvent.pointerDown(screen.getByRole("button", { name: "Delete Readable task" }));
  expect(onPointerDown).not.toHaveBeenCalled();
});

it("disables both icon controls while saving", () => {
  render(<KanbanCard card={card} onEdit={vi.fn()} onDelete={vi.fn()} isSaving />);
  expect(screen.getByRole("button", { name: "Edit Readable task" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Delete Readable task" })).toBeDisabled();
});

it("retains failed edits and restores persisted values when cancelled", async () => {
  const onEdit = vi.fn().mockResolvedValue(false);
  render(<KanbanCard card={{ ...card, priority: "high", dueDate: "2020-01-01" }} onEdit={onEdit} onDelete={vi.fn()} isSaving={false} />);
  await userEvent.click(screen.getByRole("button", { name: "Edit Readable task" }));
  await userEvent.clear(screen.getByLabelText("Card title"));
  await userEvent.type(screen.getByLabelText("Card title"), "Draft");
  await userEvent.clear(screen.getByLabelText("Due date"));
  await userEvent.selectOptions(screen.getByLabelText("Priority"), "urgent");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(screen.getByLabelText("Card title")).toHaveValue("Draft");
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await userEvent.click(screen.getByRole("button", { name: "Edit Readable task" }));
  expect(screen.getByLabelText("Card title")).toHaveValue(card.title);
  expect(screen.getByLabelText("Due date")).toHaveValue("2020-01-01");
  expect(screen.getByLabelText("Priority")).toHaveValue("high");
});

it("does not flag completed tasks as overdue", () => {
  render(<KanbanCard card={{ ...card, dueDate: "2020-01-01" }} onEdit={vi.fn()} onDelete={vi.fn()} isSaving={false} completed />);
  expect(screen.getByText(/Due:/)).toBeInTheDocument();
  expect(screen.queryByText(/Overdue:/)).not.toBeInTheDocument();
});
