import { UserManager, WebStorageStateStore } from "oidc-client-ts";

/**
 * Signing in with a customer's company login (single sign-on).
 *
 * **Only for customers who have one.** Everybody else signs in on our own
 * form, through `auth_api` — see `authService.login`. This sends the whole
 * tab to the customer's own login (Microsoft, Google, Okta) and back:
 * `kc_idp_hint` names their company login, so Keycloak passes straight
 * through without a page of its own. The tab comes back to
 * `/auth/callback`, which finishes the sign-in (`pages/AuthPages/
 * CompanyCallback.tsx`).
 *
 * **A redirect, not a popup** (changed 2026-10-15). A popup's opener cannot
 * tell it was closed once a login page cuts the link between the two
 * windows, which Keycloak's and Microsoft's do — the button waited for ever.
 * Popups are also blocked by browsers and poor on phones.
 *
 * The browser talks to Keycloak directly, with the `smartdoc-browser`
 * client: no secret, PKCE instead (`smartdoc_context/runbook-sso.md` → 1b).
 * A session made this way is refreshed and ended here too — `auth_api`'s
 * refresh uses the other client, and Keycloak only refreshes a token for
 * the client that issued it.
 */

const AUTHORITY = import.meta.env.VITE_KEYCLOAK_AUTHORITY;
const CLIENT_ID = import.meta.env.VITE_KEYCLOAK_CLIENT_ID;

// Required, and checked when the app loads rather than when somebody first
// presses the button: a missing one is a broken deployment, and should look
// like one immediately.
if (!AUTHORITY) {
  throw new Error(
    "smartdoc_ui: VITE_KEYCLOAK_AUTHORITY is required — the realm's public address, e.g. https://keycloak.fasteksystems.com/realms/smartdoc_realm",
  );
}
if (!CLIENT_ID) {
  throw new Error("smartdoc_ui: VITE_KEYCLOAK_CLIENT_ID is required — the browser client, smartdoc-browser");
}

/** The page the tab comes back to. Listed on the Keycloak client. */
export const CALLBACK_PATH = "/auth/callback";

const CAME_FROM = "smartdoc.company_came_from";

/** The page the company sign-in started from, for a way back after a failure. */
export const cameFrom = (): string => {
  try {
    return sessionStorage.getItem(CAME_FROM) || "/";
  } catch {
    return "/";
  }
};

const manager = () =>
  new UserManager({
    authority: AUTHORITY,
    client_id: CLIENT_ID,
    redirect_uri: `${window.location.origin}${CALLBACK_PATH}`,
    response_type: "code",
    scope: "openid",
    // The tokens are copied into our own storage on the way back (the same
    // keys a password sign-in uses), so the library keeps nothing after.
    userStore: new WebStorageStateStore({ store: window.sessionStorage }),
    automaticSilentRenew: false,
    monitorSession: false,
    loadUserInfo: false,
  });

/**
 * What the tab carries to the company login and back — kept by Keycloak's
 * `state`, so it survives the trip without anything else being stored.
 */
export interface CompanyTrip {
  alias: string;
  /** Where to land afterwards. */
  returnTo: string;
  /**
   * Signing in: the customer whose page it is. The person must be theirs,
   * and it is what the app holds as the current customer afterwards.
   */
  customer?: { customer_id: number; customer_name: string; customer_url: string; is_active: number };
  /**
   * Signing back in after the session expired: the Keycloak id of the person
   * whose screen it was. Anybody else is refused.
   */
  sameAs?: string;
}

export interface CompanyTokens {
  access_token: string;
  refresh_token: string;
  /** When the access token runs out, in milliseconds — like `token_expiry`. */
  token_expiry: number;
  /** Keycloak's id for the person. */
  sub: string;
}

const tokenEndpoint = `${AUTHORITY}/protocol/openid-connect/token`;
const logoutEndpoint = `${AUTHORITY}/protocol/openid-connect/logout`;

export const companyLogin = {
  /** Send the tab to the company login. Does not come back: the page goes. */
  async start(trip: CompanyTrip): Promise<void> {
    // Where "Back" goes if the way back fails before the trip can be read.
    try {
      sessionStorage.setItem(CAME_FROM, window.location.pathname);
    } catch {
      // The failure page then offers the home page instead.
    }
    await manager().signinRedirect({
      extraQueryParams: { kc_idp_hint: trip.alias },
      state: trip,
    });
  },

  /** On `/auth/callback`: the tokens, and what the trip carried. */
  async finish(): Promise<{ tokens: CompanyTokens; trip: CompanyTrip }> {
    const um = manager();
    try {
      const user = await um.signinRedirectCallback();
      if (!user.refresh_token) {
        throw new Error("Keycloak gave no refresh token — check the smartdoc-browser client");
      }
      return {
        tokens: {
          access_token: user.access_token,
          refresh_token: user.refresh_token,
          token_expiry: (user.expires_at ?? 0) * 1000,
          sub: user.profile.sub,
        },
        trip: user.state as CompanyTrip,
      };
    } finally {
      await um.removeUser().catch(() => undefined);
    }
  },

  /** A new access token for a company-login session. Throws when the session is over. */
  async refresh(refreshToken: string): Promise<Omit<CompanyTokens, "sub">> {
    const response = await fetch(tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: CLIENT_ID,
        refresh_token: refreshToken,
      }),
    });
    if (!response.ok) throw new Error("Your session has expired. Please sign in again.");
    const body = await response.json();
    return {
      access_token: body.access_token,
      refresh_token: body.refresh_token,
      token_expiry: Date.now() + body.expires_in * 1000,
    };
  },

  /**
   * End the session in Keycloak, not just in this browser.
   *
   * **Without it the next person at this computer is signed in as the last
   * one**: Keycloak remembers the session, and pressing the company button
   * again would go straight through. The company's own login (Microsoft,
   * Google) keeps its session — that one is theirs. Never throws: signing
   * out here has already happened by the time this runs.
   */
  async endSession(refreshToken: string): Promise<void> {
    try {
      await fetch(logoutEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: CLIENT_ID, refresh_token: refreshToken }),
        keepalive: true,
      });
    } catch {
      // The session times out on its own in Keycloak.
    }
  },
};
