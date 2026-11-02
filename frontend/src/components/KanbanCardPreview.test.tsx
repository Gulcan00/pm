import { render, screen } from "@testing-library/react";
import { KanbanCardPreview } from "@/components/KanbanCardPreview";

it("renders task content in the drag preview", () => {
  render(<KanbanCardPreview card={{ id: "task", title: "Launch", details: "Ship it" }} />);
  expect(screen.getByRole("heading", { name: "Launch" })).toBeInTheDocument();
  expect(screen.getByText("Ship it")).toBeInTheDocument();
});
