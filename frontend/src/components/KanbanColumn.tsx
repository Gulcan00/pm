import { useState } from "react";
import clsx from "clsx";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { Card, CardMetadata, Column } from "@/lib/kanban";
import { KanbanCard } from "@/components/KanbanCard";
import { NewCardForm } from "@/components/NewCardForm";

type KanbanColumnProps = {
  column: Column;
  cards: Card[];
  onRename: (columnId: string, title: string) => Promise<boolean>;
  onAddCard: (columnId: string, title: string, details: string, metadata: CardMetadata) => Promise<boolean>;
  onDeleteCard: (columnId: string, cardId: string) => Promise<boolean>;
  onEditCard: (cardId: string, title: string, details: string, metadata: CardMetadata) => Promise<boolean>;
  isSaving: boolean;
  columns?: Column[];
  onMoveCard?: (cardId: string, columnId: string) => Promise<boolean>;
};

export const KanbanColumn = ({
  column,
  cards,
  onRename,
  onAddCard,
  onDeleteCard,
  onEditCard,
  isSaving,
  columns,
  onMoveCard,
}: KanbanColumnProps) => {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  const [titleDraftState, setTitleDraftState] = useState({
    sourceTitle: column.title,
    draft: column.title,
  });
  const titleDraft =
    titleDraftState.sourceTitle === column.title
      ? titleDraftState.draft
      : column.title;

  const saveTitle = async () => {
    const title = titleDraft.trim();
    if (!title || title === column.title) {
      setTitleDraftState({ sourceTitle: column.title, draft: column.title });
      return;
    }
    if (await onRename(column.id, title)) {
      setTitleDraftState({ sourceTitle: title, draft: title });
    } else {
      setTitleDraftState({ sourceTitle: column.title, draft: column.title });
    }
  };

  return (
    <section
      ref={setNodeRef}
      className={clsx(
        "flex min-h-[540px] min-w-0 flex-col rounded-2xl border border-[var(--stroke)] bg-white/65 p-3 transition sm:p-4",
        isOver && "ring-2 ring-[var(--accent-yellow)]"
      )}
      data-testid={`column-${column.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="w-full">
          <div className="flex items-center gap-3">
            <div className="h-1.5 w-6 rounded-full bg-[var(--accent-yellow)]" />
            <span className="text-xs font-semibold text-[var(--gray-text)]">
              {cards.length} {cards.length === 1 ? "card" : "cards"}
            </span>
          </div>
          <input
            value={titleDraft}
            onChange={(event) =>
              setTitleDraftState({
                sourceTitle: column.title,
                draft: event.target.value,
              })
            }
            onBlur={() => void saveTitle()}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.currentTarget.blur();
              } else if (event.key === "Escape") {
                setTitleDraftState({ sourceTitle: column.title, draft: column.title });
                event.currentTarget.blur();
              }
            }}
            disabled={isSaving}
            className="mt-2 w-full min-w-0 rounded-md border border-transparent bg-transparent px-1 py-1 font-display text-lg font-semibold text-[var(--navy-dark)] transition hover:border-[var(--stroke)] focus:border-[var(--primary-blue)]"
            aria-label="Column title"
          />
        </div>
      </div>
      <div className="mt-4 flex flex-1 flex-col gap-3">
        <SortableContext items={column.cardIds} strategy={verticalListSortingStrategy}>
          {cards.map((card) => (
            <KanbanCard
              key={card.id}
              card={card}
              onDelete={(cardId) => onDeleteCard(column.id, cardId)}
              onEdit={onEditCard}
              isSaving={isSaving}
              completed={column.id === "col-done"}
              columnId={column.id}
              columns={columns}
              onMove={onMoveCard}
            />
          ))}
        </SortableContext>
        {cards.length === 0 && (
          <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-[var(--stroke)] px-3 py-6 text-center text-xs font-semibold uppercase tracking-[0.2em] text-[var(--gray-text)]">
            Drop a card here
          </div>
        )}
      </div>
      <NewCardForm
        onAdd={(title, details, metadata) => onAddCard(column.id, title, details, metadata)}
        isSaving={isSaving}
      />
    </section>
  );
};
