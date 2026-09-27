import { requireReauth } from "./sessionExpiry";

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
  // The capacity this user has on THIS project: 1 = admin, 2 = worker.
  // Per-project, not per-customer — the same person can run one project and
  // capture documents on another.
  role_id: number;
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

export const authService = {
  async login(credentials: LoginRequest): Promise<TokenResponse> {
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
      try {
        const body = await response.json();
        if (typeof body?.message === "string" && body.message) message = body.message;
      } catch {
        // No body worth reading; the generic message stands.
      }
      if (/not fully set up/i.test(message)) throw new PasswordChangeRequiredError();
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

    return response.json();
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
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
    localStorage.removeItem("user");
    localStorage.removeItem("token_expiry");
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
