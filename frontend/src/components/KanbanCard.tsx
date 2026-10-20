import { useState, type FormEvent } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import clsx from "clsx";
import type { Card } from "@/lib/kanban";

type KanbanCardProps = {
  card: Card;
  onDelete: (cardId: string) => Promise<boolean>;
  onEdit: (cardId: string, title: string, details: string) => Promise<boolean>;
  isSaving: boolean;
};

export const KanbanCard = ({ card, onDelete, onEdit, isSaving }: KanbanCardProps) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: card.id });
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(card.title);
  const [details, setDetails] = useState(card.details);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!title.trim()) {
      return;
    }
    if (await onEdit(card.id, title.trim(), details.trim())) {
      setIsEditing(false);
    }
  };

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={clsx(
        "rounded-2xl border border-transparent bg-white px-4 py-4 shadow-[0_12px_24px_rgba(3,33,71,0.08)]",
        "transition-all duration-150",
        isDragging && "opacity-60 shadow-[0_18px_32px_rgba(3,33,71,0.16)]"
      )}
      {...attributes}
      {...listeners}
      data-testid={`card-${card.id}`}
    >
      {isEditing ? (
        <form onSubmit={handleSubmit} className="grid gap-3">
          <input
            aria-label="Card title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="w-full rounded-md border border-[var(--stroke)] px-2 py-1 text-sm"
            required
          />
          <textarea
            aria-label="Card details"
            value={details}
            onChange={(event) => setDetails(event.target.value)}
            rows={3}
            className="w-full resize-y rounded-md border border-[var(--stroke)] px-2 py-1 text-sm"
          />
          <div className="flex gap-2">
            <button type="submit" disabled={isSaving} className="text-xs font-semibold text-[var(--primary-blue)]">
              Save
            </button>
            <button
              type="button"
              disabled={isSaving}
              onClick={() => {
                setTitle(card.title);
                setDetails(card.details);
                setIsEditing(false);
              }}
              className="text-xs font-semibold text-[var(--gray-text)]"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="flex items-start justify-between gap-3">
          <div>
            <h4 className="font-display text-base font-semibold text-[var(--navy-dark)]">
              {card.title}
            </h4>
            <p className="mt-2 text-sm leading-6 text-[var(--gray-text)]">
              {card.details}
            </p>
          </div>
          <div className="flex shrink-0 gap-1">
            <button
              type="button"
              disabled={isSaving}
              onClick={() => {
                setTitle(card.title);
                setDetails(card.details);
                setIsEditing(true);
              }}
              className="rounded-full border border-transparent px-2 py-1 text-xs font-semibold text-[var(--gray-text)] transition hover:border-[var(--stroke)] hover:text-[var(--navy-dark)]"
              aria-label={`Edit ${card.title}`}
            >
              Edit
            </button>
            <button
              type="button"
              disabled={isSaving}
              onClick={() => void onDelete(card.id)}
              className="rounded-full border border-transparent px-2 py-1 text-xs font-semibold text-[var(--gray-text)] transition hover:border-[var(--stroke)] hover:text-[var(--navy-dark)]"
              aria-label={`Delete ${card.title}`}
            >
              Remove
            </button>
          </div>
        </div>
      )}
    </article>
  );
};
