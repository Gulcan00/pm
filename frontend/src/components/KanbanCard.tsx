import { useState, type FormEvent } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import clsx from "clsx";
import { isOverdue, type Card, type CardMetadata, type Column } from "@/lib/kanban";
import { CardMetadataFields } from "@/components/CardMetadataFields";

type KanbanCardProps = {
  card: Card;
  onDelete: (cardId: string) => Promise<boolean>;
  onEdit: (cardId: string, title: string, details: string, metadata: CardMetadata) => Promise<boolean>;
  isSaving: boolean;
  completed?: boolean;
  columnId?: string;
  columns?: Column[];
  onMove?: (cardId: string, columnId: string) => Promise<boolean>;
};

export const KanbanCard = ({ card, onDelete, onEdit, isSaving, completed = false, columnId, columns, onMove }: KanbanCardProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: card.id, disabled: isSaving || isEditing });
  const [title, setTitle] = useState(card.title);
  const [details, setDetails] = useState(card.details);
  const [metadata, setMetadata] = useState<CardMetadata>({ priority: card.priority ?? "medium", dueDate: card.dueDate ?? null });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!title.trim()) {
      return;
    }
    if (await onEdit(card.id, title.trim(), details.trim(), metadata)) {
      setIsEditing(false);
    }
  };

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={clsx(
        "min-w-0 rounded-xl border border-[var(--stroke)] bg-white p-4 shadow-[0_3px_12px_rgba(3,33,71,0.05)] hover:border-[var(--primary-blue)]/30",
        "transition-all duration-150",
        isDragging && "opacity-60 shadow-[0_18px_32px_rgba(3,33,71,0.16)]"
      )}
      {...(isEditing ? {} : attributes)}
      {...(isEditing ? {} : listeners)}
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
            maxLength={200}
          />
          <textarea
            aria-label="Card details"
            value={details}
            onChange={(event) => setDetails(event.target.value)}
            rows={3}
            maxLength={5000}
            className="w-full resize-y rounded-md border border-[var(--stroke)] px-2 py-1 text-sm"
          />
          <CardMetadataFields value={metadata} onChange={setMetadata} />
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
                setMetadata({ priority: card.priority ?? "medium", dueDate: card.dueDate ?? null });
                setIsEditing(false);
              }}
              className="text-xs font-semibold text-[var(--gray-text)]"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div>
          <div className="[overflow-wrap:anywhere]">
            <h4 className="font-display text-base font-semibold leading-6 text-[var(--navy-dark)]">
              {card.title}
            </h4>
            <p className="mt-2 text-sm leading-6 text-[var(--gray-text)]">
              {card.details}
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <span className={`priority-badge priority-${card.priority ?? "medium"}`}>{card.priority ?? "medium"}</span>
              {card.dueDate && <span className={!completed && isOverdue(card.dueDate, new Date().toLocaleDateString("en-CA")) ? "font-semibold text-red-700" : "text-slate-600"}>
                {!completed && isOverdue(card.dueDate, new Date().toLocaleDateString("en-CA")) ? "Overdue: " : "Due: "}
                <time dateTime={card.dueDate}>{card.dueDate}</time>
              </span>}
            </div>
          </div>
          {onMove && columns && <div className="mt-3" onPointerDown={(event) => event.stopPropagation()}>
            <select className="workspace-input w-full text-xs" aria-label={`Move ${card.title} to`} value={columnId} disabled={isSaving}
              onChange={(event) => void onMove(card.id, event.target.value)}>
              {columns.map((column) => <option key={column.id} value={column.id}>{column.title}</option>)}
            </select>
          </div>}
          <div className="mt-3 flex justify-end gap-1" onPointerDown={(event) => event.stopPropagation()}>
            <button
              type="button"
              disabled={isSaving}
              onClick={() => {
                setTitle(card.title);
                setDetails(card.details);
                setMetadata({ priority: card.priority ?? "medium", dueDate: card.dueDate ?? null });
                setIsEditing(true);
              }}
              className="card-action hover:bg-[var(--surface)] hover:text-[var(--primary-blue)]"
              aria-label={`Edit ${card.title}`}
              title={`Edit ${card.title}`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m16 3 5 5M4 20l5-1L21 7a2.1 2.1 0 0 0-5-5L4 14l-1 7Z" />
              </svg>
            </button>
            <button
              type="button"
              disabled={isSaving}
              onClick={() => void onDelete(card.id)}
              className="card-action hover:bg-red-50 hover:text-red-700"
              aria-label={`Delete ${card.title}`}
              title={`Delete ${card.title}`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </article>
  );
};
