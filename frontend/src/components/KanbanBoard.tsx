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
import { moveCard, type BoardData } from "@/lib/kanban";

export const KanbanBoard = ({
  onLogout,
  logoutError,
}: {
  onLogout?: () => void;
  logoutError?: string;
}) => {
  const [board, setBoard] = useState<BoardData | null>(null);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);

  useEffect(() => {
    let active = true;
    setBoard(null);
    setLoadError("");

    fetch("/api/board", {
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
  }, [loadAttempt]);

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

    if (!board || isSaving || !over || active.id === over.id) {
      return;
    }

    const cardId = active.id as string;
    const columns = moveCard(board.columns, cardId, over.id as string);
    const destination = columns.find((column) => column.cardIds.includes(cardId));
    if (!destination) {
      return;
    }
    void persistBoard(`/api/board/cards/${cardId}/move`, {
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
    return persistBoard(`/api/board/columns/${columnId}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    });
  };

  const handleAddCard = (columnId: string, title: string, details: string) => {
    return persistBoard("/api/board/cards", {
      method: "POST",
      body: JSON.stringify({ columnId, title, details }),
    });
  };

  const handleDeleteCard = (columnId: string, cardId: string) => {
    void columnId;
    return persistBoard(`/api/board/cards/${cardId}`, {
      method: "DELETE",
    });
  };

  const handleEditCard = (cardId: string, title: string, details: string) =>
    persistBoard(`/api/board/cards/${cardId}`, {
      method: "PATCH",
      body: JSON.stringify({ title, details }),
    });

  const activeCard = activeCardId ? cardsById[activeCardId] : null;

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

      <main className="relative mx-auto flex min-h-screen max-w-[1500px] flex-col gap-10 px-6 pb-16 pt-12">
        {logoutError && (
          <p role="alert" className="text-sm font-semibold text-red-700">
            {logoutError}
          </p>
        )}
        <header className="flex flex-col gap-6 rounded-[32px] border border-[var(--stroke)] bg-white/80 p-8 shadow-[var(--shadow)] backdrop-blur">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-[var(--gray-text)]">
                Single Board Kanban
              </p>
              <h1 className="mt-3 font-display text-4xl font-semibold text-[var(--navy-dark)]">
                Kanban Studio
              </h1>
              <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--gray-text)]">
                Keep momentum visible. Rename columns, drag cards between stages,
                and capture quick notes without getting buried in settings.
              </p>
            </div>
            <div className="rounded-2xl border border-[var(--stroke)] bg-[var(--surface)] px-5 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--gray-text)]">
                Focus
              </p>
              <p className="mt-2 text-lg font-semibold text-[var(--primary-blue)]">
                One board. Five columns. Zero clutter.
              </p>
            </div>
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
              className="rounded-lg border border-[var(--stroke)] px-4 py-3 text-sm font-semibold text-[var(--navy-dark)] transition hover:bg-[var(--surface)]"
            >
              {isChatOpen ? "Close assistant" : "AI assistant"}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            {board.columns.map((column) => (
              <div
                key={column.id}
                className="flex items-center gap-2 rounded-full border border-[var(--stroke)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--navy-dark)]"
              >
                <span className="h-2 w-2 rounded-full bg-[var(--accent-yellow)]" />
                {column.title}
              </div>
            ))}
          </div>
        </header>

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
              ? "grid items-start gap-6 2xl:grid-cols-[minmax(0,1fr)_360px]"
              : "grid items-start gap-6"
          }
        >
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <section className="order-last grid gap-6 lg:grid-cols-5 2xl:order-first">
              {board.columns.map((column) => (
                <KanbanColumn
                  key={column.id}
                  column={column}
                  cards={column.cardIds.map((cardId) => board.cards[cardId])}
                  onRename={handleRenameColumn}
                  onAddCard={handleAddCard}
                  onDeleteCard={handleDeleteCard}
                  onEditCard={handleEditCard}
                  isSaving={isSaving}
                />
              ))}
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
          />
        </div>
      </main>
    </div>
  );
};
