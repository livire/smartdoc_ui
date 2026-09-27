/**
 * The session lock.
 *
 * When the session ends, the person is not sent anywhere. The screen they
 * were on stays exactly as it is — half-filled forms, selected documents,
 * scroll position and all — and a prompt on top asks for their password.
 * Once they sign in, the calls that failed are retried and the screen
 * carries on as though nothing happened.
 *
 * This module holds only the state, so that the code doing the asking (the
 * fetch guard) and the code doing the showing (the prompt) do not have to
 * know about each other.
 */

/**
 * How long after the token ran out the lock is still the right answer.
 *
 * The lock exists to save what is on screen — a half-filled form, a batch
 * part-way through. That is worth doing for someone who stepped away for a
 * coffee. Someone coming back the next morning has nothing on screen worth
 * saving: everything showing is hours stale, and Keycloak dropped the
 * session behind it long ago. They get the sign-in page, which is what they
 * expect to see. Thirty minutes matches the realm's idle rule, so beyond it
 * the session is certainly gone.
 */
export const LOCK_WINDOW_MS = 30 * 60_000;

type Listener = (locked: boolean) => void;

let locked = false;
const listeners = new Set<Listener>();

// Everyone waiting for the person to sign back in. There may be several —
// a screen usually has more than one call in flight when the session ends —
// and they are all answered by the same sign-in.
let waiting: Array<(signedBackIn: boolean) => void> = [];

function announce() {
  listeners.forEach((listener) => listener(locked));
}

export function isSessionLocked() {
  return locked;
}

export function onSessionLockChange(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Ask for the password and wait. Resolves true once they have signed back
 * in, false if they chose to sign out instead.
 */
/**
 * Whether asking for a password could work at all.
 *
 * Two cases where it cannot: a sign-in page, which is already the way back
 * in, and a session with no stored account, which has nobody to ask about.
 * The prompt hides itself in both — and until 2026-09-18 the code waiting
 * for it did not, so the wait never ended: `AuthContext` sat on that promise
 * with `isLoading` true, and the sign-in button read "Signing in..." for
 * ever.
 */
function canLock(): boolean {
  const path = window.location.pathname;
  if (path === "/" || path === "/signin" || path === "/signup" || path.startsWith("/sys")) {
    return false;
  }
  try {
    return Boolean(localStorage.getItem("user"));
  } catch {
    return false;
  }
}

export function requireReauth(): Promise<boolean> {
  // Nothing to lock: answer at once, as though the person chose to sign out.
  // The caller then does what it does when a session ends, which on these
  // pages is exactly right.
  if (!canLock()) return Promise.resolve(false);

  if (!locked) {
    locked = true;
    announce();
  }

  return new Promise<boolean>((resolve) => {
    waiting.push(resolve);
  });
}

/** Signed back in — release everything that was waiting. */
export function sessionRestored() {
  locked = false;
  const pending = waiting;
  waiting = [];
  announce();
  pending.forEach((resolve) => resolve(true));
}

/** Chose to sign out — release everything that was waiting, unsuccessfully. */
export function sessionAbandoned() {
  locked = false;
  const pending = waiting;
  waiting = [];
  announce();
  pending.forEach((resolve) => resolve(false));
}
