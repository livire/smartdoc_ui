import { authService } from "./authService";
import { LOCK_WINDOW_MS, requireReauth } from "./sessionExpiry";

// Signing in and refreshing must be exempt: a 401 from those is "wrong
// password" or "your refresh token has expired", which the calling code
// already handles. Locking the screen on them would trap someone inside the
// prompt that is trying to let them out.
const EXEMPT = ["/user_token", "/refresh_token", "/service_token"];

const isExempt = (url: string) => EXEMPT.some((path) => url.includes(path));

// One recovery at a time. A screen usually has several calls in flight, so
// they all fail together; without this they would each open their own
// prompt.
let recovery: Promise<string | null> | null = null;

function recoverSession(): Promise<string | null> {
  if (!recovery) {
    recovery = attemptRecovery().finally(() => {
      recovery = null;
    });
  }
  return recovery;
}

async function attemptRecovery(): Promise<string | null> {
  // The access token may simply have aged out while the refresh token is
  // still good — worth one quiet attempt before troubling anyone.
  try {
    await authService.refreshToken();
    return authService.getStoredToken();
  } catch {
    // Refresh is dead too. Now it needs a password.
  }

  // Away long enough that the lock would be asking someone to unlock a screen
  // full of stale work. Sign in properly instead.
  if (authService.msUntilExpiry() < -LOCK_WINDOW_MS) {
    authService.sessionExpired();
    return null;
  }

  const signedBackIn = await requireReauth();
  return signedBackIn ? authService.getStoredToken() : null;
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/**
 * Put the new token on the retry. Returns null when the original request
 * carried no Authorization header, which means retrying it would change
 * nothing.
 */
function retryInit(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  token: string,
): RequestInit | null {
  const source =
    init?.headers ?? (input instanceof Request ? input.headers : undefined);
  const headers = new Headers(source as HeadersInit | undefined);

  if (!headers.has("Authorization")) return null;

  headers.set("Authorization", `Bearer ${token}`);
  return { ...init, headers };
}

/**
 * One place that notices the session has ended.
 *
 * Every screen calls a handful of APIs, and each was left to interpret a
 * failure on its own — which is how an expired session turned into "No
 * assignment in progress", "No projects found", and an empty table,
 * depending on which screen you happened to be looking at.
 *
 * A 401 from our own APIs means the token is no longer accepted. Rather than
 * hand that back to the screen, the call is held: the person is asked for
 * their password, and the request is then sent again with the new token. As
 * far as the screen is concerned the call simply took a while.
 *
 * 403 is deliberately NOT included — that's a permission the account lacks
 * (Keycloak's `view-users`, say), which is a real answer to a real question
 * and belongs to the screen that asked.
 */
export function installSessionGuard() {
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input, init) => {
    const response = await originalFetch(input, init);

    if (response.status !== 401) return response;

    const url = urlOf(input);

    // Only for calls that carried a token — an anonymous call getting 401
    // says nothing about the session.
    if (isExempt(url) || !authService.getStoredToken()) return response;

    const token = await recoverSession();
    if (!token) return response;

    const retry = retryInit(input, init, token);
    if (!retry) return response;

    // Safe to send `init` again because every caller in this app passes a
    // string or FormData body, neither of which is consumed by the first
    // attempt.
    return originalFetch(url, retry);
  };
}
