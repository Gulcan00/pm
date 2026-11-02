"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { KanbanColumn } from "@/components/KanbanColumn";
import { KanbanCardPreview } from "@/components/KanbanCardPreview";
import { AIChatSidebar } from "@/components/AIChatSidebar";
import { moveCard, matchesCard, isOverdue, type BoardData, type CardMetadata } from "@/lib/kanban";

export const KanbanBoard = ({
  onLogout,
  logoutError,
  boardId,
  boardName,
  boardDescription,
}: {
  onLogout?: () => void;
  logoutError?: string;
  boardId?: number;
  boardName?: string;
  boardDescription?: string;
}) => {
  const [board, setBoard] = useState<BoardData | null>(null);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const apiBase = boardId ? `/api/boards/${boardId}` : "/api/board";

  useEffect(() => {
    let active = true;
    setBoard(null);
    setLoadError("");

    fetch(apiBase, {
      credentials: "same-origin",
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Board request failed.");
        }
        const data = (await response.json()) as BoardData;
        if (active) {
          setBoard(data);
        }
      })
      .catch(() => {
        if (active) {
          setLoadError("Unable to load the board. Check your connection and try again.");
        }
      });

    return () => {
      active = false;
    };
  }, [loadAttempt, apiBase]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    })
  );

  const cardsById = useMemo(() => board?.cards ?? {}, [board]);

  const persistBoard = async (
    url: string,
    init: RequestInit,
    failureMessage = "Unable to save changes. Try again."
  ) => {
    if (isSaving) {
      return false;
    }
    setSaveError("");
    setIsSaving(true);
    try {
      const response = await fetch(url, {
        ...init,
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          ...init.headers,
        },
      });
      if (!response.ok) {
        throw new Error("Board update failed.");
      }
      setBoard((await response.json()) as BoardData);
      return true;
    } catch {
      setSaveError(failureMessage);
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveCardId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveCardId(null);

    if (!board || isSaving || search.trim() || priorityFilter !== "all" || !over || active.id === over.id) {
      return;
    }

    const cardId = active.id as string;
    const columns = moveCard(board.columns, cardId, over.id as string);
    const destination = columns.find((column) => column.cardIds.includes(cardId));
    if (!destination) {
      return;
    }
    void persistBoard(`${apiBase}/cards/${cardId}/move`, {
      method: "POST",
      body: JSON.stringify({
        columnId: destination.id,
        position: destination.cardIds.indexOf(cardId),
      }),
    });
  };

  const handleRenameColumn = (columnId: string, title: string) => {
    if (board?.columns.find((column) => column.id === columnId)?.title === title) {
      return Promise.resolve(true);
    }
    return persistBoard(`${apiBase}/columns/${columnId}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    });
  };

  const handleAddCard = (columnId: string, title: string, details: string, metadata: CardMetadata) => {
    return persistBoard(`${apiBase}/cards`, {
      method: "POST",
      body: JSON.stringify({ columnId, title, details, ...metadata }),
    });
  };

  const handleDeleteCard = (columnId: string, cardId: string) => {
    void columnId;
    return persistBoard(`${apiBase}/cards/${cardId}`, {
      method: "DELETE",
    });
  };

  const handleEditCard = (cardId: string, title: string, details: string, metadata: CardMetadata) =>
    persistBoard(`${apiBase}/cards/${cardId}`, {
      method: "PATCH",
      body: JSON.stringify({ title, details, ...metadata }),
    });

  const activeCard = activeCardId ? cardsById[activeCardId] : null;
  const cards = Object.values(cardsById);
  const completedIds = new Set(board?.columns.find((column) => column.id === "col-done")?.cardIds);
  const overdueCount = cards.filter((card) => !completedIds.has(card.id) && isOverdue(card.dueDate, new Date().toLocaleDateString("en-CA"))).length;
  const matchingCount = cards.filter((card) => matchesCard(card, search, priorityFilter)).length;

  if (!board) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6">
        {loadError ? (
          <>
            <p role="alert" className="text-sm font-semibold text-red-700">
              {loadError}
            </p>
            <button
              type="button"
              onClick={() => setLoadAttempt((attempt) => attempt + 1)}
              className="rounded-md border border-[var(--stroke)] px-4 py-2 text-sm font-semibold text-[var(--navy-dark)]"
            >
              Retry
            </button>
          </>
        ) : (
          <p role="status" className="text-sm font-semibold text-[var(--gray-text)]">
            Loading board...
          </p>
        )}
      </main>
    );
  }

  return (
    <div className="relative overflow-hidden">
      <div className="pointer-events-none absolute left-0 top-0 h-[420px] w-[420px] -translate-x-1/3 -translate-y-1/3 rounded-full bg-[radial-gradient(circle,_rgba(32,157,215,0.25)_0%,_rgba(32,157,215,0.05)_55%,_transparent_70%)]" />
      <div className="pointer-events-none absolute bottom-0 right-0 h-[520px] w-[520px] translate-x-1/4 translate-y-1/4 rounded-full bg-[radial-gradient(circle,_rgba(117,57,145,0.18)_0%,_rgba(117,57,145,0.05)_55%,_transparent_75%)]" />

      <main className="relative flex min-h-screen w-full flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        {logoutError && (
          <p role="alert" className="text-sm font-semibold text-red-700">
            {logoutError}
          </p>
        )}
        <header className="rounded-3xl border border-[var(--stroke)] bg-white/90 p-5 shadow-[var(--shadow)] sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-5">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-[var(--gray-text)]">
                Project workspace
              </p>
              <h1 className="mt-2 font-display text-3xl font-semibold text-[var(--navy-dark)] sm:text-4xl">
                {boardName ?? board.name ?? "Kanban Studio"}
              </h1>
              <p className="mt-2 text-sm leading-6 text-[var(--gray-text)]">
                {boardDescription || board.description || "Keep momentum visible. Drag cards to move work forward."}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <p className="mr-2 text-sm text-[var(--gray-text)]">
                <span className="font-semibold text-[var(--navy-dark)]">{Object.keys(board.cards).length}</span>{" "}
                {Object.keys(board.cards).length === 1 ? "card" : "cards"}
                <span aria-hidden="true" className="mx-2 text-[var(--accent-yellow)]">/</span>
                {board.columns.length} stages
              </p>
              {onLogout && (
                <button
                  type="button"
                  onClick={onLogout}
                  className="rounded-lg border border-(--stroke) px-4 py-3 text-sm font-semibold text-foreground transition hover:bg-background"
                >
                  Sign out
                </button>
              )}
              <button
                type="button"
                aria-controls="ai-chat-sidebar"
                aria-expanded={isChatOpen}
                onClick={() => setIsChatOpen((open) => !open)}
                className="rounded-lg bg-[var(--secondary-purple)] px-4 py-3 text-sm font-semibold text-white transition hover:brightness-110"
              >
                {isChatOpen ? "Close assistant" : "AI assistant"}
              </button>
            </div>
          </div>
        </header>
        <section aria-label="Project overview" className="flex flex-wrap items-center gap-5 rounded-2xl border border-[var(--stroke)] bg-white p-4 text-sm">
          <p><strong>{completedIds.size} / {cards.length}</strong> completed</p>
          <progress aria-label="Project completion" value={completedIds.size} max={cards.length || 1} className="max-w-40 accent-[var(--secondary-purple)]" />
          <p><strong>{overdueCount}</strong> overdue</p>
          <label className="flex items-center gap-2">Search cards<input type="search" className="workspace-input w-48" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Title or details" /></label>
          <label className="flex items-center gap-2">Filter priority<select className="workspace-input" value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}>
            <option value="all">All priorities</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option>
          </select></label>
          {(search || priorityFilter !== "all") && <p role="status">{matchingCount} matching cards. Clear filters to drag cards.</p>}
        </section>

        {saveError && (
          <p role="alert" className="text-sm font-semibold text-red-700">
            {saveError}
          </p>
        )}
        {isSaving && (
          <p role="status" className="text-sm font-semibold text-[var(--gray-text)]">
            Saving changes...
          </p>
        )}

        <div
          className={
            isChatOpen
              ? "board-workspace board-workspace-with-chat"
              : "board-workspace"
          }
        >
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <section
              aria-label="Kanban board"
              tabIndex={0}
              className="kanban-scroll"
            >
              <div className="kanban-columns">
                {board.columns.map((column) => (
                  <KanbanColumn
                    key={column.id}
                    column={column}
                    cards={column.cardIds.map((cardId) => board.cards[cardId]).filter((card) => matchesCard(card, search, priorityFilter))}
                    onRename={handleRenameColumn}
                    onAddCard={handleAddCard}
                    onDeleteCard={handleDeleteCard}
                    onEditCard={handleEditCard}
                    isSaving={isSaving}
                    columns={board.columns}
                    onMoveCard={(cardId, columnId) => persistBoard(`${apiBase}/cards/${cardId}/move`, {
                      method: "POST",
                      body: JSON.stringify({ columnId, position: board.columns.find((item) => item.id === columnId)?.cardIds.length ?? 0 }),
                    })}
                  />
                ))}
              </div>
            </section>
            <DragOverlay>
              {activeCard ? (
                <div className="w-[260px]">
                  <KanbanCardPreview card={activeCard} />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
          <AIChatSidebar
            isOpen={isChatOpen}
            board={board}
            onClose={() => setIsChatOpen(false)}
            onBoardChange={setBoard}
            boardId={boardId}
          />
        </div>
      </main>
    </div>
  );
};
