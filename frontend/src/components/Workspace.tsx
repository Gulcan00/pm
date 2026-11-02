"use client";

import { useEffect, useState, type FormEvent } from "react";
import { KanbanBoard } from "@/components/KanbanBoard";
import { AccountSettings } from "@/components/AccountSettings";
import type { BoardData, BoardSummary } from "@/lib/kanban";

type Props = {
  username: string;
  onLogout: () => void;
  onAccountDeleted: () => void;
  logoutError: string;
};

export const Workspace = ({ username, onLogout, onAccountDeleted, logoutError }: Props) => {
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [editing, setEditing] = useState<"new" | "edit" | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [settings, setSettings] = useState(false);
  const selected = boards.find((board) => board.id === selectedId);

  useEffect(() => {
    let active = true;
    fetch("/api/boards", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to load your boards.");
        const data = (await response.json()) as BoardSummary[];
        if (active) {
          setBoards(data);
          setSelectedId(data[0]?.id ?? null);
          setError("");
        }
      })
      .catch(() => {
        if (active) setError("Unable to load your boards. Try again.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [attempt]);

  const saveBoard = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const response = await fetch(editing === "new" ? "/api/boards" : `/api/boards/${selectedId}`, {
        method: editing === "new" ? "POST" : "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description }),
      });
      if (!response.ok) throw new Error("Unable to save the board. Try again.");
      const board = (await response.json()) as BoardData & { id: number; name: string; description: string };
      setBoards((current) => editing === "new"
        ? [...current, { ...board, cardCount: 0, completedCount: 0 }]
        : current.map((item) => item.id === board.id ? { ...item, name: board.name, description: board.description } : item));
      setSelectedId(board.id);
      setEditing(null);
    } catch {
      setError("Unable to save the board. Try again.");
    } finally { setPending(false); }
  };

  const deleteBoard = async () => {
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/boards/${selectedId}`, { method: "DELETE", credentials: "same-origin" });
      if (!response.ok) throw new Error("Unable to delete the board.");
      const remaining = boards.filter((board) => board.id !== selectedId);
      setBoards(remaining);
      setSelectedId(remaining[0]?.id ?? null);
      setDeleting(false);
    } catch {
      setError("Unable to delete the board. Try again.");
    } finally { setPending(false); }
  };

  const beginEditing = (mode: "new" | "edit") => {
    setName(mode === "new" ? "" : selected?.name ?? "");
    setDescription(mode === "new" ? "" : selected?.description ?? "");
    setEditing(mode);
    setDeleting(false);
  };

  return (
    <div>
      <nav aria-label="Workspace" className="workspace-toolbar">
        <strong className="text-[var(--navy-dark)]">{username}&apos;s workspace</strong>
        <div className="flex items-center gap-2 text-sm">
          <label htmlFor="workspace-board">Board</label>
          <select id="workspace-board" value={selectedId ?? ""} disabled={loading || pending || editing !== null}
            onChange={(event) => { setSelectedId(Number(event.target.value)); setDeleting(false); }}
            className="workspace-input max-w-64">
            {!boards.length && <option value="">No boards yet</option>}
            {boards.map((board) => <option key={board.id} value={board.id}>{board.name}</option>)}
          </select>
        </div>
        <button className="workspace-button" disabled={loading || pending} onClick={() => beginEditing("new")}>New board</button>
        {selected && <>
          <button className="workspace-button" disabled={pending} onClick={() => beginEditing("edit")}>Board settings</button>
          <button className="workspace-button" disabled={pending} onClick={() => { setDeleting(true); setEditing(null); }}>Delete board</button>
        </>}
        <button className="workspace-button" onClick={() => setSettings((value) => !value)}>Account settings</button>
        <button className="workspace-button" onClick={onLogout}>Sign out</button>
      </nav>
      {(error || logoutError) && <div role="alert" className="mx-6 my-3 text-red-700">
        {error || logoutError}
        {!selected && !loading && <button className="workspace-button ml-3" onClick={() => { setLoading(true); setAttempt((value) => value + 1); }}>Retry</button>}
      </div>}
      {settings && <AccountSettings username={username} onDeleted={onAccountDeleted} onClose={() => setSettings(false)} />}
      {editing && <form aria-label={editing === "new" ? "Create board" : "Edit board"} onSubmit={saveBoard} className="workspace-panel">
        <h2 className="font-semibold">{editing === "new" ? "Create board" : "Edit board"}</h2>
        <label className="grid gap-1">Board name<input className="workspace-input" value={name} onChange={(event) => setName(event.target.value)} required maxLength={100} /></label>
        <label className="grid gap-1">Description<textarea className="workspace-input" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} /></label>
        <div className="flex gap-2">
          <button className="workspace-button" disabled={pending || !name.trim()} type="submit">{editing === "new" ? "Create board" : "Save board"}</button>
          <button className="workspace-button" disabled={pending} type="button" onClick={() => setEditing(null)}>Cancel</button>
        </div>
      </form>}
      {deleting && <section aria-label="Confirm board deletion" className="workspace-panel">
        <p>Delete &quot;{selected?.name}&quot; and all its cards? This cannot be undone.</p>
        <div className="flex gap-2">
          <button className="workspace-button text-red-700" disabled={pending} onClick={() => void deleteBoard()}>Confirm delete board</button>
          <button className="workspace-button" disabled={pending} onClick={() => setDeleting(false)}>Cancel</button>
        </div>
      </section>}
      {loading ? <p role="status" className="workspace-panel">Loading boards...</p>
        : selected ? <KanbanBoard key={selected.id} boardId={selected.id} boardName={selected.name} boardDescription={selected.description} />
          : !error && <section className="workspace-panel"><h1 className="text-2xl font-semibold">Your next project starts here</h1><p>Create a board to start organizing your work.</p></section>}
    </div>
  );
};
