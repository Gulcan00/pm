"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Workspace } from "@/components/Workspace";

type AuthStatus = "checking" | "signed-in" | "signed-out";

export const AuthGate = () => {
  const [status, setStatus] = useState<AuthStatus>("checking");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [registering, setRegistering] = useState(false);
  const [signedInUsername, setSignedInUsername] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        const identity = response.ok ? (await response.json()) as { username: string } : null;
        if (active) {
          setSignedInUsername(identity?.username ?? "");
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
      const response = await fetch(registering ? "/api/auth/register" : "/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!response.ok) {
        setError(response.status === 429 ? "Too many account attempts. Try again shortly."
          : registering ? (response.status === 409 ? "Username is already taken." : "Use a valid username and a password of at least 12 characters.")
            : "Invalid username or password.");
        return;
      }
      const identity = (await response.json()) as { username: string };
      setSignedInUsername(identity.username);
      setPassword("");
      setRegistering(false);
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
      if (!response.ok && response.status !== 401) {
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
    return <Workspace username={signedInUsername} onLogout={handleLogout} logoutError={error}
      onAccountDeleted={() => { setPassword(""); setStatus("signed-out"); }} />;
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
        <p className="mt-2 text-sm text-[var(--gray-text)]">{registering ? "Create your private workspace." : "Sign in to continue."}</p>

        <div className="mt-7 grid gap-4">
          <label className="grid gap-2 text-sm font-semibold text-[var(--navy-dark)]">
            Username
            <input
              autoComplete="username"
              required
              minLength={registering ? 3 : 1}
              maxLength={64}
              pattern={registering ? "[a-zA-Z0-9_-]+" : undefined}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="rounded-md border border-[var(--stroke)] px-3 py-2.5 font-normal outline-none focus:border-[var(--primary-blue)]"
            />
          </label>
          <label className="grid gap-2 text-sm font-semibold text-[var(--navy-dark)]">
            Password
            <input
              type="password"
              autoComplete={registering ? "new-password" : "current-password"}
              required
              minLength={registering ? 12 : 1}
              maxLength={256}
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
          {pending ? "Please wait..." : registering ? "Create account" : "Sign in"}
        </button>
        <button type="button" disabled={pending} className="mt-4 w-full text-sm font-semibold text-[var(--primary-blue)]"
          onClick={() => { setRegistering((value) => !value); setError(""); setPassword(""); }}>
          {registering ? "Back to sign in" : "Create an account"}
        </button>
      </form>
    </main>
  );
};