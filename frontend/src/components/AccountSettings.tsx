import { useState, type FormEvent } from "react";

export const AccountSettings = ({ username, onDeleted, onClose }: {
  username: string;
  onDeleted: () => void;
  onClose: () => void;
}) => {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(deleting ? "/api/auth/account" : "/api/auth/password", {
        method: deleting ? "DELETE" : "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(deleting ? { username, password: currentPassword }
          : { current_password: currentPassword, new_password: newPassword }),
      });
      if (!response.ok) {
        if (response.status === 403) throw new Error("Current password is incorrect.");
        if (response.status === 429) throw new Error("Too many account attempts. Try again shortly.");
        throw new Error("Unable to update your account. Try again.");
      }
      if (deleting) { onDeleted(); return; }
      setCurrentPassword("");
      setNewPassword("");
      setMessage("Password changed. Other sessions have been signed out.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to update your account.");
    } finally { setPending(false); }
  };

  return (
    <form aria-label="Account settings" onSubmit={submit} className="workspace-panel">
      <h2 className="font-semibold">Account settings: {username}</h2>
      <label className="grid gap-1">Current password<input className="workspace-input" type="password" autoComplete="current-password" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
      {!deleting && <label className="grid gap-1">New password (at least 12 characters)<input className="workspace-input" type="password" autoComplete="new-password" minLength={12} maxLength={256} required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>}
      {deleting && <p className="text-red-700">Permanently delete your account, every board and every card? Enter your current password to confirm. This cannot be undone.</p>}
      {error && <p role="alert" className="text-red-700">{error}</p>}
      {message && <p role="status">{message}</p>}
      <div className="flex flex-wrap gap-2">
        <button className="workspace-button" disabled={pending} type="submit">{deleting ? "Confirm delete account" : "Change password"}</button>
        <button className="workspace-button text-red-700" disabled={pending} type="button" onClick={() => { setDeleting((value) => !value); setError(""); setMessage(""); }}>{deleting ? "Cancel deletion" : "Delete account"}</button>
        <button className="workspace-button" disabled={pending} type="button" onClick={onClose}>Close settings</button>
      </div>
    </form>
  );
};
