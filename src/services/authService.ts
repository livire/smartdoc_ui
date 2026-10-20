import { requireReauth, LOCK_WINDOW_MS } from "./sessionExpiry";
import { forgetAll } from "./cache";
import { companyLogin } from "./companyLogin";

/**
 * Set while somebody is signed in through their company login, to its
 * alias (`customer-55`). It decides how the session is refreshed, renewed
 * and ended — see `companyLogin.ts`. Absent for a password session.
 */
const COMPANY_LOGIN = "smartdoc.company_login";

const API_BASE_URL = import.meta.env.VITE_AUTH_API_URL;
const API_URL = import.meta.env.VITE_API_URL;

export interface LoginRequest {
  username: string;
  password: string;
}

export interface TokenResponse {
  data: {
    access_token: string;
    refresh_token: string;
    token_expiry: number;
    token_type: string;
  };
}

export interface UserInfo {
  data: {
    sub: string;
    email_verified: boolean;
    name: string;
    preferred_username: string;
    given_name: string;
    family_name: string;
    email: string;
    roles: string[];
    groups: string[];
    user_id?: number;
  };
}

export interface UserProject {
  user_project_id: number;
  user_id: number;
  project_id: number;
  // The capacity this user has on THIS project: 1 = admin, 2 = worker,
  // 4 = viewer. Per-project, not per-customer — the same person can run one
  // project and capture documents on another.
  role_id: number;
  // Exceptions for this one person in the reading app. Null means "use
  // whatever the role gives", which is what every row says until somebody
  // is told no. Only a viewer's are read.
  can_comment?: number | null;
  can_annotate?: number | null;
  can_forward?: number | null;
  /**
   * The project itself, joined on by `GET /user_project/user/:id`.
   *
   * **Every screen that lists somebody's projects needs the name**, and a
   * membership row is ids only — which is why the server includes it. Read
   * it from here rather than fetching the customer's project list beside it:
   * that second call needs a customer in context, and a screen that has not
   * got one silently showed "Project 41".
   */
  project?: {
    project_id: number;
    project_name: string;
    customer_id?: number;
    identifier_label?: string | null;
  } | null;
}

export interface UserProjectsResponse {
  data: UserProject[];
}

// Keycloak's answer to a temporary password on our own sign-in form: the
// password was right, but the person has to choose their own before a
// token is issued. Our form cannot ask on Keycloak's behalf, so it asks
// itself — see `completePassword` and `SignInForm`.
export const PASSWORD_CHANGE_REQUIRED = "PasswordChangeRequired";

export class PasswordChangeRequiredError extends Error {
  constructor() {
    super("Choose a new password to finish signing in");
    this.name = PASSWORD_CHANGE_REQUIRED;
  }
}

// The other reason Keycloak refuses a sign-in with the same words: the
// address on the account has not been verified. There is nothing the form
// can do about it here — the link is in the person's inbox — so the screen
// says so and offers to send it again.
export const EMAIL_VERIFICATION_REQUIRED = "EmailVerificationRequired";

export class EmailVerificationRequiredError extends Error {
  readonly username: string;

  constructor(username: string) {
    super("Check your email and follow the link to verify your address, then sign in");
    this.name = EMAIL_VERIFICATION_REQUIRED;
    this.username = username;
  }
}

export const authService = {
  async login(credentials: LoginRequest): Promise<TokenResponse> {
    // Whatever session this replaces, it is no longer a system one. Only
    // signing out used to clear the mark, so a /sys session that timed out
    // sent the next customer sign-in to /sys. SystemSignIn sets it again
    // once /user/me has confirmed a system administrator.
    try {
      localStorage.removeItem("smartdoc.system_session");
      // A password session from here on, whatever the last one was.
      localStorage.removeItem(COMPANY_LOGIN);
    } catch {
      // Storage refused: nothing was there to clear.
    }

    const response = await fetch(`${API_BASE_URL}/user_token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        username: credentials.username,
        password: credentials.password,
      }),
    });

    if (!response.ok) {
      // The refusal's own words: a wrong password, a disabled account and a
      // password waiting to be changed are three different things to do
      // next, and "Login failed" said none of them.
      let message = "Login failed";
      let actionRequired: string[] = [];
      try {
        const body = await response.json();
        if (typeof body?.message === "string" && body.message) message = body.message;
        if (Array.isArray(body?.action_required)) actionRequired = body.action_required;
      } catch {
        // No body worth reading; the generic message stands.
      }
      // "Account is not fully set up" is Keycloak's wording for every
      // pending step, so it cannot be acted on by itself — choosing a
      // password and verifying an address are different screens. auth_api
      // says which step it is; the message alone is the fallback for an
      // older auth_api that does not.
      if (actionRequired.includes("VERIFY_EMAIL")) {
        throw new EmailVerificationRequiredError(credentials.username);
      }
      if (actionRequired.includes("UPDATE_PASSWORD") || /not fully set up/i.test(message)) {
        throw new PasswordChangeRequiredError();
      }
      throw new Error(message);
    }

    return response.json();
  },

  /**
   * Finish a sign-in that stopped at "choose a new password".
   *
   * Sends the temporary password as proof along with the new one; auth_api
   * sets the new one as permanent and signs the person in with it. The
   * tokens come back exactly as from `login`, so the caller carries on the
   * same way.
   */
  /**
   * **Emailing a link lives in `passwordLinkService`, not here** (2026-10-13).
   *
   * `forgotPassword` and `resendVerification` used to be here and asked
   * `auth_api` to send Keycloak's own mails. Those mails land on Keycloak's
   * pages, which know one password policy for the whole realm — so a
   * customer asking for 12 characters and a symbol got 8 enforced. Both are
   * now one call to `smartdoc_api`, which signs a link to a SmartDoc page
   * that does know the customer. The `auth_api` endpoints still exist; this
   * application no longer uses them.
   */

  async completePassword(username: string, password: string, newPassword: string): Promise<TokenResponse> {
    const response = await fetch(`${API_BASE_URL}/complete_password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, new_password: newPassword }),
    });

    if (!response.ok) {
      let message = "Could not set the new password";
      try {
        const body = await response.json();
        if (typeof body?.message === "string" && body.message) message = body.message;
      } catch {
        // As above.
      }
      throw new Error(message);
    }

    const body = await response.json();

    // The password was set, but another step still blocks sign-in — an
    // unverified address, today. A 200 with no tokens is not a failure and
    // must not be reported as one: the password really did change, and
    // telling somebody otherwise leaves them typing the old one.
    if (!body?.data?.access_token) {
      const pending: string[] = body?.data?.action_required ?? [];
      if (pending.includes("VERIFY_EMAIL")) throw new EmailVerificationRequiredError(username);
      throw new Error(body?.data?.message || "Your password is set, but the account is not ready yet");
    }

    return body;
  },

  /** Their own first and last name; who "they" are comes from the token. */
  async updateProfile(firstName: string, lastName: string, accessToken: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/update_profile`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ first_name: firstName, last_name: lastName }),
    });

    if (!response.ok) {
      let message = "Could not save the name";
      try {
        const body = await response.json();
        if (typeof body?.message === "string" && body.message) message = body.message;
      } catch {
        // No body worth reading.
      }
      throw new Error(message);
    }
  },

  async refreshToken(): Promise<TokenResponse> {
    const refreshToken = this.getStoredRefreshToken();
    if (!refreshToken) {
      throw new Error("No refresh token available");
    }

    // A company-login session is refreshed with Keycloak directly: its
    // tokens belong to the browser client, and auth_api refreshes for the
    // other one.
    if (this.companyAlias()) {
      const fresh = await companyLogin.refresh(refreshToken);
      this.saveTokens(fresh.access_token, fresh.refresh_token, fresh.token_expiry);
      return { data: { ...fresh, token_type: "user" } };
    }

    const response = await fetch(`${API_BASE_URL}/refresh_token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        refresh_token: refreshToken,
      }),
    });

    if (!response.ok) {
      // The refresh token is dead too — Keycloak's idle timeout. Nobody is
      // sent anywhere over this: the callers ask for a password and try
      // again (see `sessionGuard.ts`).
      throw new Error("Your session has expired. Please sign in again.");
    }

    const data = await response.json();
    const { access_token, refresh_token, token_expiry } = data.data;
    this.saveTokens(access_token, refresh_token, token_expiry);
    return data;
  },

  async getUserInfo(accessToken: string): Promise<UserInfo> {
    const response = await fetch(`${API_BASE_URL}/userinfo`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        access_token: accessToken,
      }).toString(),
    });

    if (!response.ok) {
      throw new Error("Failed to fetch user info");
    }

    const userInfo = await response.json();
    const { preferred_username } = userInfo.data;

    // Fetch user_id from API
    const userIdResponse = await fetch(
      `${API_URL}/user/username/${preferred_username}`,
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (userIdResponse.ok) {
      const userIdData = await userIdResponse.json();
      if (userIdData.data && userIdData.data.user_id) {
        userInfo.data.user_id = userIdData.data.user_id;
      }
    }

    return userInfo;
  },

  getStoredToken(): string | null {
    return localStorage.getItem("access_token");
  },

  getStoredRefreshToken(): string | null {
    return localStorage.getItem("refresh_token");
  },

  getStoredUser() {
    const user = localStorage.getItem("user");
    return user ? JSON.parse(user) : null;
  },

  saveTokens(accessToken: string, refreshToken: string, expiresIn: number) {
    localStorage.setItem("access_token", accessToken);
    localStorage.setItem("refresh_token", refreshToken);
    localStorage.setItem("token_expiry", String(expiresIn));
  },

  saveUser(user: UserInfo["data"]) {
    localStorage.setItem("user", JSON.stringify(user));
  },

  /** The company login this session came through, or null for a password one. */
  companyAlias(): string | null {
    try {
      return localStorage.getItem(COMPANY_LOGIN);
    } catch {
      return null;
    }
  },

  /** Keep a company-login session, with what it needs to refresh and end itself. */
  saveCompanySession(
    tokens: { access_token: string; refresh_token: string; token_expiry: number },
    alias: string,
  ) {
    this.saveTokens(tokens.access_token, tokens.refresh_token, tokens.token_expiry);
    localStorage.setItem(COMPANY_LOGIN, alias);
  },

  /**
   * The company-login button: send the tab to the customer's own login.
   * `customer` is the customer whose page it is; the way back checks the
   * person is theirs (`finishCompanySignIn`).
   */
  async startCompanySignIn(
    alias: string,
    customer: { customer_id: number; customer_name: string; customer_url: string; is_active: number },
  ): Promise<void> {
    await companyLogin.start({
      alias,
      customer: {
        customer_id: customer.customer_id,
        customer_name: customer.customer_name,
        customer_url: customer.customer_url,
        is_active: customer.is_active,
      },
      returnTo: `/${customer.customer_url}`,
    });
  },

  /**
   * The session-expired prompt for somebody who has no SmartDoc password:
   * the company login again, coming back to this same page.
   *
   * **The same person or nothing** — the way back refuses a different
   * Keycloak id. A colleague signed in to Microsoft on the same computer
   * would otherwise land in this person's work.
   */
  async restartCompanySession(): Promise<void> {
    const alias = this.companyAlias();
    const sub = this.getStoredUser()?.sub;
    if (!alias || !sub) throw new Error("No signed-in user to re-authenticate");
    await companyLogin.start({
      alias,
      sameAs: sub,
      returnTo: `${window.location.pathname}${window.location.search}`,
    });
  },

  /**
   * On `/auth/callback`: keep the session, check who it is, and say where to
   * go. Throws with words to show when the person may not have it — and
   * then nothing of the session is left behind.
   */
  async finishCompanySignIn(): Promise<string> {
    const { tokens, trip } = await companyLogin.finish();

    // Signing back in after the session expired: only the same person.
    if (trip.sameAs) {
      if (tokens.sub !== trip.sameAs) {
        void companyLogin.endSession(tokens.refresh_token);
        throw new Error(
          "That is a different account. Sign in as the person whose work was on screen, or sign out.",
        );
      }
      this.saveCompanySession(tokens, trip.alias);
      return trip.returnTo;
    }

    // Signing in. A new day's work, as with a password — see AuthContext's
    // `login` — and whatever session this replaces is not a system one.
    try {
      localStorage.removeItem("selected_project");
      sessionStorage.removeItem("projects_checked");
      localStorage.removeItem("smartdoc.system_session");
    } catch {
      // A browser refusing storage asks anyway.
    }
    this.saveCompanySession(tokens, trip.alias);

    // **This customer's person, or nobody.** A password sign-in proves it
    // with the customer's prefix on the username; the company login has
    // none. Keycloak only attaches a company login to accounts on that
    // customer's domains, but SmartDoc's own record decides, as it does for
    // every request after this one.
    const me = await this.getMe(tokens.access_token);
    if (!trip.customer || !me.user_id || Number(me.customer_id) !== Number(trip.customer.customer_id)) {
      this.logout();
      throw new Error(
        me.user_id
          ? "Your account belongs to a different organisation in SmartDoc. Sign in at your own organisation's address."
          : "Your company login worked, but there is no SmartDoc account for you here. Ask your administrator to add you.",
      );
    }

    this.saveUser((await this.getUserInfo(tokens.access_token)).data);
    localStorage.setItem("customer_data", JSON.stringify(trip.customer));
    return trip.returnTo;
  },

  /**
   * Sign in again as the same person, without disturbing anything else.
   *
   * Only the tokens are replaced — the stored user, customer and selected
   * project stay as they are, so the screen underneath the prompt is still
   * looking at the same work when this returns. The username is taken from
   * storage rather than typed, so this can never quietly swap one person's
   * session for another's.
   */
  async reauthenticate(password: string): Promise<void> {
    const username = this.getStoredUser()?.preferred_username;
    if (!username) {
      throw new Error("No signed-in user to re-authenticate");
    }

    const tokenResponse = await this.login({ username, password });
    const { access_token, refresh_token, token_expiry } = tokenResponse.data;
    this.saveTokens(access_token, refresh_token, token_expiry);
  },

  // Clear everything and go back to sign-in, keeping the customer in the URL
  // so the right login page loads.
  sessionExpired() {
    // A session that began at /sys belongs to a system account, whose way
    // back in is /sys — not the sign-in page of whichever customer they
    // were inside when it ended.
    let fromSystem = false;
    try {
      fromSystem = localStorage.getItem("smartdoc.system_session") === "1";
    } catch {
      fromSystem = false;
    }
    if (fromSystem) {
      this.logout();
      localStorage.removeItem("smartdoc.system_session");
      localStorage.removeItem("customer_data");
      if (window.location.pathname !== "/sys") window.location.assign("/sys");
      return;
    }

    let customerUrl: string | null = null;
    try {
      const stored = localStorage.getItem("customer_data");
      customerUrl = stored ? JSON.parse(stored)?.customer_url ?? null : null;
    } catch {
      customerUrl = null;
    }

    this.logout();

    // "/" is not a sign-in page — it is the dashboard, behind the same guard
    // we just failed. Sending someone there with no token produced a blank
    // screen, so when the customer is unknown we reload instead and let
    // ProtectedRoute say what happened.
    if (!customerUrl) {
      window.location.reload();
      return;
    }

    const target = `/${customerUrl}`;
    if (window.location.pathname !== target) {
      window.location.assign(target);
    }
  },

  logout() {
    // A company-login session is ended in Keycloak too, or the next person
    // to press the company button at this computer goes straight in as this
    // one. Not awaited: everything below happens whatever Keycloak says.
    const alias = this.companyAlias();
    const refresh = this.getStoredRefreshToken();
    if (alias && refresh) void companyLogin.endSession(refresh);
    localStorage.removeItem(COMPANY_LOGIN);

    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
    localStorage.removeItem("user");
    localStorage.removeItem("token_expiry");
    // The cached lists die with it. They are held for the tab, not for the
    // account, so without this the next person to sign in at this browser
    // would be handed the previous one's users and projects. Same line as
    // the viewer's `logout()`, for the same reason.
    forgetAll();
  },

  isTokenExpired(): boolean {
    const expiry = localStorage.getItem("token_expiry");
    if (!expiry) return true;
    return Date.now() > parseInt(expiry);
  },

  // How long the access token has left, in milliseconds. Negative once it has
  // gone. `token_expiry` is an absolute epoch time, not a duration.
  msUntilExpiry(): number {
    const expiry = localStorage.getItem("token_expiry");
    if (!expiry) return -1;
    return parseInt(expiry) - Date.now();
  },

  async ensureValidToken(): Promise<string> {
    const token = this.getStoredToken();
    if (!token) {
      // Nothing to refresh with — the session is over, whether it expired or
      // was cleared in another tab.
      this.sessionExpired();
      throw new Error("Your session has expired. Please sign in again.");
    }

    if (this.isTokenExpired()) {
      try {
        await this.refreshToken();
      } catch {
        // Long gone — the next morning, say: nothing on screen is worth
        // keeping, so the sign-in page, as the fetch guard already does
        // (sessionGuard.ts). This path asked for the password however old
        // the session was (2026-10-20).
        if (this.msUntilExpiry() < -LOCK_WINDOW_MS) {
          this.sessionExpired();
          throw new Error("Your session has expired. Please sign in again.");
        }
        // Ask for the password and hold on until it is given, so whatever
        // the screen was doing continues instead of collapsing into an
        // empty state.
        const signedBackIn = await requireReauth();
        if (!signedBackIn) {
          throw new Error("Your session has expired. Please sign in again.");
        }
      }
      return this.getStoredToken() || "";
    }

    return token;
  },

  async verifyUserCustomerAccess(
    username: string,
    customerId: number,
    accessToken: string
  ): Promise<boolean> {
    const response = await fetch(
      `${API_URL}/username/${username}/customer/${customerId}`,
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      throw new Error("Failed to verify user access");
    }

    const result = await response.json();

    if (!result.data || result.data === null) {
      throw new Error("User does not have access to this customer");
    }

    return true;
  },

  async getUserProjects(userId: number, accessToken: string): Promise<UserProjectsResponse> {
    const response = await fetch(
      `${API_URL}/user_project/user/${userId}`,
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      throw new Error("Failed to fetch user projects");
    }

    return response.json();
  },

  /**
   * Who the caller is across the whole customer.
   *
   * Separate from project membership on purpose: a customer administrator
   * sets up projects, storages, users and branding, and may belong to no
   * project at all — so the project-scoped answer cannot speak for them.
   */
  async getMe(
    accessToken: string,
  ): Promise<{
    user_id: number | null;
    customer_id: number | null;
    role_id: number | null;
    is_customer_admin: boolean;
    is_sysadmin: boolean;
  }> {
    const response = await fetch(`${API_URL}/user/me`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      // Deny by default: a hiccup must not hand somebody the customer's
      // settings screens.
      return {
        user_id: null,
        customer_id: null,
        role_id: null,
        is_customer_admin: false,
        is_sysadmin: false,
      };
    }

    const body = await response.json();
    return body.data;
  },
};
