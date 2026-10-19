"use client";

import { useEffect, useState, type FormEvent } from "react";
import { KanbanBoard } from "@/components/KanbanBoard";

type AuthStatus = "checking" | "signed-in" | "signed-out";

export const AuthGate = () => {
  const [status, setStatus] = useState<AuthStatus>("checking");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store" })
      .then((response) => {
        if (active) {
          setStatus(response.ok ? "signed-in" : "signed-out");
        }
      })
      .catch(() => {
        if (active) {
          setStatus("signed-out");
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError("");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!response.ok) {
        setError("Invalid username or password.");
        return;
      }
      setStatus("signed-in");
    } catch {
      setError("Unable to sign in. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  };

  const handleLogout = async () => {
    setError("");
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
      });
      if (!response.ok) {
        throw new Error("Sign out failed.");
      }
      setPassword("");
      setStatus("signed-out");
    } catch {
      setError("Unable to sign out. Check your connection and try again.");
    }
  };

  if (status === "checking") {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <p role="status" className="text-sm font-semibold text-[var(--gray-text)]">
          Loading workspace...
        </p>
      </main>
    );
  }

  if (status === "signed-in") {
    return (
      <>
        {error && (
          <p role="alert" className="sr-only">
            {error}
          </p>
        )}
        <KanbanBoard onLogout={handleLogout} />
      </>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-12">
      <form
        onSubmit={handleLogin}
        className="w-full max-w-sm border border-[var(--stroke)] bg-white p-8 shadow-[var(--shadow)]"
      >
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--gray-text)]">
          Project workspace
        </p>
        <h1 className="mt-3 font-display text-3xl font-semibold text-[var(--navy-dark)]">
          Kanban Studio
        </h1>
        <p className="mt-2 text-sm text-[var(--gray-text)]">Sign in to continue.</p>

        <div className="mt-7 grid gap-4">
          <label className="grid gap-2 text-sm font-semibold text-[var(--navy-dark)]">
            Username
            <input
              autoComplete="username"
              required
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="rounded-md border border-[var(--stroke)] px-3 py-2.5 font-normal outline-none focus:border-[var(--primary-blue)]"
            />
          </label>
          <label className="grid gap-2 text-sm font-semibold text-[var(--navy-dark)]">
            Password
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="rounded-md border border-[var(--stroke)] px-3 py-2.5 font-normal outline-none focus:border-[var(--primary-blue)]"
            />
          </label>
        </div>

        {error && (
          <p role="alert" className="mt-4 text-sm font-semibold text-red-700">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="mt-6 w-full rounded-md bg-[var(--secondary-purple)] px-4 py-3 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-60"
        >
          {pending ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </main>
  );
};