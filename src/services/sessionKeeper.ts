import { authService } from "./authService";
import { LOCK_WINDOW_MS, requireReauth } from "./sessionExpiry";

/**
 * Keeps the session alive rather than waiting for it to break.
 *
 * The guard in `sessionGuard.ts` catches a 401 and asks for a password. That
 * is the safety net; this is the thing that stops anyone needing it. While
 * the tab is open the access token is refreshed shortly before it expires,
 * so an ordinary day's work never sees the prompt at all — only a refresh
 * token that has itself died (Keycloak's SSO Session Idle) reaches it.
 *
 * Why it is worth doing: the prompt appears over whatever you were doing.
 * Harmless, but it is still an interruption, and one that happens on a timer
 * nobody chose.
 */

// Refresh this long before the token expires, so a slow request or a sleeping
// laptop does not leave a window where calls fail.
const RENEW_BEFORE_MS = 60_000;

// How long without a sign of life before this stops renewing.
//
// Renewing on a timer alone kept an abandoned tab signed in for the whole
// SSO Session Max — ten hours on this realm — which quietly cancelled the
// realm's 30-minute idle rule. A machine left unlocked at the end of the day
// was still signed in the next morning.
//
// Activity, not visibility: a tab can be the visible one while its owner
// spends an hour in another application, and the browser still calls it
// visible.
const IDLE_LIMIT_MS = 15 * 60_000;
// Never schedule tighter than this, in case the clock says something odd.
const MIN_DELAY_MS = 5_000;

let timer: number | null = null;
let running = false;
let lastActivity = Date.now();

const stillHere = () => Date.now() - lastActivity < IDLE_LIMIT_MS;

const clear = () => {
  if (timer !== null) window.clearTimeout(timer);
  timer = null;
};

async function renewNow() {
  if (!authService.getStoredToken()) return;

  // Nobody has touched anything for a while. Let the session lapse the way
  // Keycloak intends; whoever comes back is asked for a password, with their
  // screen still behind the prompt.
  if (!stillHere()) {
    schedule();
    return;
  }

  try {
    await authService.refreshToken();
  } catch {
    // The refresh token is dead too. A short lapse gets the lock, with the
    // screen kept behind it; a long one gets the sign-in page.
    if (authService.msUntilExpiry() < -LOCK_WINDOW_MS) {
      stopSessionKeeper();
      authService.sessionExpired();
      return;
    }

    // Ask for a password rather than letting the next click be the thing
    // that discovers it.
    const signedBackIn = await requireReauth();
    if (!signedBackIn) {
      stopSessionKeeper();
      return;
    }
  }

  schedule();
}

function schedule() {
  clear();
  if (!running || !authService.getStoredToken()) return;

  const delay = Math.max(MIN_DELAY_MS, authService.msUntilExpiry() - RENEW_BEFORE_MS);
  // When idle this comes back around and finds nothing to do, which is what
  // lets a person returning to the tab pick up again without a reload.
  timer = window.setTimeout(renewNow, stillHere() ? delay : Math.min(delay, 60_000));
}

export function startSessionKeeper() {
  if (running) return;
  running = true;
  schedule();

  // What counts as a sign of life. Passive listeners so none of this can slow
  // a scroll down.
  const seen = () => {
    lastActivity = Date.now();
  };
  ["pointerdown", "keydown", "wheel", "touchstart"].forEach((event) =>
    window.addEventListener(event, seen, { passive: true }),
  );

  // A laptop that slept comes back with timers that never fired and a token
  // that expired while it was closed. Check on the way back in.
  // Coming back to the tab is itself a sign of life, and a laptop that slept
  // returns with timers that never fired and a token that expired while it
  // was closed.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || !running) return;
    seen();
    if (authService.msUntilExpiry() < RENEW_BEFORE_MS) renewNow();
    else schedule();
  });
}

export function stopSessionKeeper() {
  running = false;
  clear();
}
