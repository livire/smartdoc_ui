import { useEffect, useRef, useState } from "react";
import { authService } from "../../services/authService";
import {
  isSessionLocked,
  onSessionLockChange,
  sessionAbandoned,
  sessionRestored,
} from "../../services/sessionExpiry";
import Toast from "../common/Toast";

/**
 * Asks for the password over whatever screen the person was on.
 *
 * Nothing behind it is unmounted or reloaded, so a half-captured batch, a
 * part-filled form or a chosen document is all still there afterwards.
 */
export default function SessionExpiredPrompt() {
  const [locked, setLocked] = useState(isSessionLocked);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => onSessionLockChange(setLocked), []);

  useEffect(() => {
    if (locked) {
      setPassword("");
      setError(null);
      setSigningIn(false);
      // A beat, so the field exists before it is focused.
      const id = window.setTimeout(() => passwordRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
    }
  }, [locked]);

  const username = authService.getStoredUser()?.preferred_username ?? "";

  // A sign-in page is already the way back in. Locking one behind a prompt
  // asks for a password over a screen that asks for a password — and with
  // no account to lock to, the prompt had a blank username and could sign
  // nobody back in.
  // `/:customerUrl` on its own is a dashboard for somebody signed in, so it
  // is not in this list — a session expiring there should still lock.
  const path = window.location.pathname;
  const onSignInPage =
    path === "/" || path === "/signin" || path === "/signup" || path.startsWith("/sys");

  if (!locked || !username || onSignInPage) return null;

  const signIn = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!password || signingIn) return;

    setSigningIn(true);
    setError(null);
    try {
      await authService.reauthenticate(password);
      // Releases every call that was waiting; they are sent again with the
      // new token and the screen carries on.
      sessionRestored();
    } catch {
      setError("That password was not accepted. Try again.");
      setSigningIn(false);
      passwordRef.current?.select();
    }
  };

  const signOut = () => {
    sessionAbandoned();
    authService.sessionExpired();
  };

  return (
    <div className="fixed inset-0 z-[100000] flex items-center justify-center bg-gray-900/60 p-4 backdrop-blur-sm">
      <form
        onSubmit={signIn}
        className="w-full max-w-md rounded-2xl bg-white p-7 shadow-xl dark:bg-gray-900"
      >
        <h2 className="text-lg font-semibold text-gray-800 dark:text-white/90">
          Your session has expired
        </h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Sign in again to carry on. Nothing on this screen has been lost.
        </p>

        {/* Read-only rather than absent: it reads as the pair it is, and
            makes clear which account is being signed back in. */}
        <div className="mt-6">
          <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
            Username
          </label>
          <input
            type="text"
            value={username}
            readOnly
            className="h-11 w-full cursor-default rounded-lg border border-gray-200 bg-gray-50 px-4 text-sm text-gray-600 focus:outline-hidden dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-300"
          />
        </div>

        <div className="mt-4">
          <label
            htmlFor="session-password"
            className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400"
          >
            Password
          </label>
          <input
            id="session-password"
            ref={passwordRef}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:text-white/90"
          />
        </div>

        {error && <Toast message={error} type="error" onClose={() => setError(null)} />}

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={signOut}
            className="rounded-lg px-3 py-2 text-sm font-medium text-gray-600 hover:text-error-500 dark:text-gray-400"
          >
            Sign out
          </button>
          <button
            type="submit"
            disabled={!password || signingIn}
            className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:bg-brand-300"
          >
            {signingIn ? "Signing in…" : "Sign in"}
          </button>
        </div>
      </form>
    </div>
  );
}
