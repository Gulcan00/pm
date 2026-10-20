import { useState, type FormEvent } from "react";
import type { BoardData, BoardOperation } from "@/lib/kanban";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type ChatResponse = {
  assistant_text: string;
  operations: BoardOperation[];
};

type AIChatSidebarProps = {
  isOpen: boolean;
  board: BoardData;
  onClose: () => void;
  onBoardChange: (board: BoardData) => void;
};

const operationSummary = (operation: BoardOperation, board: BoardData) => {
  const cardTitle = (cardId: string) => board.cards[cardId]?.title ?? cardId;
  const columnTitle = (columnId: string) =>
    board.columns.find((column) => column.id === columnId)?.title ?? columnId;

  switch (operation.type) {
    case "create_card":
      return `Create “${operation.title}” in ${columnTitle(operation.column_id)}`;
    case "update_card":
      return `Update “${cardTitle(operation.card_id)}”`;
    case "move_card":
      return `Move “${cardTitle(operation.card_id)}” to ${columnTitle(operation.column_id)}`;
    case "delete_card":
      return `Delete “${cardTitle(operation.card_id)}”`;
    case "rename_column":
      return `Rename ${columnTitle(operation.column_id)} to “${operation.title}”`;
  }
};

export const AIChatSidebar = ({
  isOpen,
  board,
  onClose,
  onBoardChange,
}: AIChatSidebarProps) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [error, setError] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [pendingOperations, setPendingOperations] = useState<BoardOperation[]>([]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submittedQuestion = question.trim();
    if (!submittedQuestion || isPending || isApplying || pendingOperations.length > 0) {
      return;
    }

    setError("");
    setIsPending(true);
    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: submittedQuestion, history: messages }),
      });
      if (!response.ok) {
        const failure = (await response.json().catch(() => null)) as
          | { detail?: string }
          | null;
        throw new Error(failure?.detail || "Assistant request failed. Try again.");
      }

      const result = (await response.json()) as ChatResponse;
      if (result.operations.length > 0) {
        setPendingOperations(result.operations);
      }
      setMessages((current) => [
        ...current,
        { role: "user", content: submittedQuestion },
        { role: "assistant", content: result.assistant_text },
      ]);
      setQuestion("");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Assistant request failed. Try again."
      );
    } finally {
      setIsPending(false);
    }
  };

  const handleApply = async () => {
    setError("");
    setIsApplying(true);
    try {
      const response = await fetch("/api/ai/apply", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operations: pendingOperations }),
      });
      if (!response.ok) {
        const failure = (await response.json().catch(() => null)) as
          | { detail?: string }
          | null;
        throw new Error(failure?.detail || "Unable to apply changes. Try again.");
      }

      onBoardChange((await response.json()) as BoardData);
      setPendingOperations([]);
      setMessages((current) => [
        ...current,
        { role: "assistant", content: "Changes applied." },
      ]);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to apply changes. Try again."
      );
    } finally {
      setIsApplying(false);
    }
  };

  const handleDiscard = () => {
    setPendingOperations([]);
    setMessages((current) => [
      ...current,
      { role: "assistant", content: "Changes discarded." },
    ]);
  };

  return (
    <aside
      id="ai-chat-sidebar"
      aria-label="AI assistant"
      hidden={!isOpen}
      className="order-first flex max-h-[720px] min-h-[320px] flex-col overflow-hidden rounded-lg border border-[var(--stroke)] bg-white shadow-[var(--shadow)] 2xl:order-last 2xl:sticky 2xl:top-6"
    >
      <header className="flex items-center justify-between border-b border-[var(--stroke)] px-4 py-3">
        <h2 className="font-display text-lg font-semibold text-[var(--navy-dark)]">
          AI assistant
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-[var(--stroke)] px-3 py-1.5 text-sm font-semibold text-[var(--gray-text)] hover:text-[var(--navy-dark)]"
        >
          Close
        </button>
      </header>

      <div
        aria-live="polite"
        className="flex-1 space-y-3 overflow-y-auto p-4"
      >
        {messages.length === 0 ? (
          <p className="text-sm text-[var(--gray-text)]">No messages yet.</p>
        ) : (
          messages.map((message, index) => (
            <div
              key={`${message.role}-${index}`}
              className={`max-w-[90%] whitespace-pre-wrap rounded-lg border px-3 py-2 text-sm leading-5 ${
                message.role === "user"
                  ? "ml-auto border-[var(--primary-blue)]/20 bg-[var(--primary-blue)]/10 text-[var(--navy-dark)]"
                  : "border-[var(--stroke)] bg-[var(--surface)] text-[var(--navy-dark)]"
              }`}
            >
              {message.content}
            </div>
          ))
        )}
        {isPending && (
          <p role="status" className="text-sm text-[var(--gray-text)]">
            Thinking...
          </p>
        )}
        {pendingOperations.length > 0 && (
          <section aria-label="Proposed board changes" className="rounded-md border border-[var(--stroke)] p-3">
            <h3 className="text-sm font-semibold text-[var(--navy-dark)]">Proposed changes</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--navy-dark)]">
              {pendingOperations.map((operation, index) => (
                <li key={`${operation.type}-${index}`}>
                  {operationSummary(operation, board)}
                </li>
              ))}
            </ul>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => void handleApply()}
                disabled={isApplying}
                className="rounded-md bg-[var(--secondary-purple)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {isApplying ? "Applying..." : "Apply changes"}
              </button>
              <button
                type="button"
                onClick={handleDiscard}
                disabled={isApplying}
                className="rounded-md border border-[var(--stroke)] px-3 py-2 text-sm font-semibold text-[var(--navy-dark)] disabled:opacity-50"
              >
                Discard
              </button>
            </div>
          </section>
        )}
      </div>

      <form onSubmit={handleSubmit} className="grid gap-3 border-t border-[var(--stroke)] p-4">
        {error && (
          <p role="alert" className="text-sm font-semibold text-red-700">
            {error}
          </p>
        )}
        <label className="sr-only" htmlFor="ai-chat-question">
          Message
        </label>
        <textarea
          id="ai-chat-question"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask about this board"
          rows={3}
          disabled={isPending || isApplying || pendingOperations.length > 0}
          className="w-full resize-y rounded-md border border-[var(--stroke)] px-3 py-2 text-sm outline-none focus:border-[var(--primary-blue)]"
        />
        <button
          type="submit"
          disabled={isPending || isApplying || pendingOperations.length > 0 || !question.trim()}
          className="justify-self-end rounded-md bg-[var(--secondary-purple)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {isPending ? "Sending..." : "Send"}
        </button>
      </form>
    </aside>
  );
};