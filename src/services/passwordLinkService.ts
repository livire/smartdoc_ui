const API_URL = import.meta.env.VITE_API_URL;

/**
 * Setting a password from an emailed link.
 *
 * **Why this is not in `authService`.** Everything there talks to
 * `auth_api`, which wraps Keycloak. These three talk to `smartdoc_api`,
 * because the thing that makes this flow worth having is that the page knows
 * the customer — and so can apply **that customer's** password rules, which
 * live in `customer_setting` and which Keycloak's own page knows nothing
 * about.
 *
 * **Nobody is signed in for any of these**, so none of them sends a token.
 * What stands in for one is the link: signed by the server with a secret
 * only it holds, good for an hour, and dead once a password has been set.
 *
 * **The token goes in the body, never the URL.** `smartdoc_api` logs every
 * request URL, so a token in the path would put a working password link in
 * a log file. That is also why the emailed link carries it after a `#` —
 * browsers keep everything after the hash to themselves.
 */

const message = async (response: Response, fallback: string) => {
  try {
    const body = await response.json();
    return body?.message || fallback;
  } catch {
    return fallback;
  }
};

/** What a password must look like here, as the server answers it. */
export interface PasswordRules {
  password_min_length: number;
  password_needs_digit: 0 | 1;
  password_needs_symbol: 0 | 1;
  password_needs_capital: 0 | 1;
}

export interface LinkFacts {
  /** 'invite' is a first password, 'reset' is a replacement. */
  purpose: "invite" | "reset";
  customer_url: string;
  customer_name: string | null;
  /** What they know themselves as, without the customer prefix. */
  username: string;
  /** What Keycloak holds, which is what signing in needs. */
  login_username: string;
  rules: PasswordRules;
  /** The rules as one sentence, written by the server. */
  description: string;
}

export const passwordLinkService = {
  /**
   * Ask for a link. Answers the same whether the account exists or not, so
   * this cannot be used to find out who has an account here.
   *
   * The server works out which link is needed — a first password or a
   * replacement — from the state of the account.
   */
  async request(username: string, customerUrl: string): Promise<string> {
    const response = await fetch(`${API_URL}/password_reset/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, customer_url: customerUrl }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.message || "Could not send the email");
    return body?.data?.message || "If that account exists, a link is on its way.";
  },

  /** Whose link is this, and what must the password look like? */
  async check(token: string): Promise<LinkFacts> {
    const response = await fetch(`${API_URL}/password_reset/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (!response.ok) {
      throw new Error(await message(response, "That link is no longer valid"));
    }
    return (await response.json()).data;
  },

  /** Set it. Answers the stored username, which is what signing in needs. */
  async complete(token: string, password: string): Promise<{ username: string; customer_url: string }> {
    const response = await fetch(`${API_URL}/password_reset/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    if (!response.ok) {
      throw new Error(await message(response, "Could not set the password"));
    }
    return (await response.json()).data;
  },
};

/** Every rule, and whether this password meets it — for the live checklist. */
export const checkAgainst = (password: string, rules: PasswordRules) => {
  const list: { text: string; met: boolean }[] = [
    {
      text: `At least ${rules.password_min_length} characters`,
      met: password.length >= rules.password_min_length,
    },
  ];
  if (rules.password_needs_digit) list.push({ text: "A number", met: /[0-9]/.test(password) });
  if (rules.password_needs_capital) {
    list.push({ text: "A capital letter", met: /[A-Z]/.test(password) });
  }
  if (rules.password_needs_symbol) {
    list.push({ text: "A symbol", met: /[^A-Za-z0-9]/.test(password) });
  }
  return list;
};
