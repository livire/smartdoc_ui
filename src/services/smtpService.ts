import { authService } from "./authService";

const API_URL = import.meta.env.VITE_API_URL;

const jsonHeaders = (accessToken: string) => ({
  Authorization: `Bearer ${accessToken}`,
  "Content-Type": "application/json",
});

const extractMessage = async (response: Response, fallback: string) => {
  try {
    const body = await response.json();
    return body?.message || body?.error || fallback;
  } catch {
    return fallback;
  }
};

/**
 * The email accounts SmartDoc's mail goes out through.
 *
 * **SmartDoc's own are set on `/sys` → Email**, and whoever runs SmartDoc
 * chooses one for each customer (`customer.smtp_id`). **There is no default
 * account**: a customer with none chosen is sent no mail until somebody
 * chooses, rather than quietly following a flag on another row.
 *
 * A customer may add one of their own when SmartDoc has allowed it
 * (`customer.can_add_smtp`), and their people's password links then come
 * from their address instead.
 *
 * **The password never comes back.** It goes to Vault at
 * `kv/smartdoc_smtp/<id>`, and the only answer about it is whether one is
 * stored — the same arrangement as a storage's S3 keys, and for the same
 * reason: `smartdoc_api` writes every response body to its log.
 */

/** 587 is STARTTLS and what almost everything uses. */
export const ALLOWED_PORTS = [587, 465, 25];

export interface SmtpAccount {
  smtp_id: number;
  /** **Null is SmartDoc's own.** A customer id means they added it. */
  customer_id: number | null;
  display_name: string;
  host: string;
  port: number;
  username: string;
  from_address: string;
  from_name: string | null;
  is_active: 0 | 1;
  created_at: string;
}

export type NewSmtpAccount = Omit<SmtpAccount, "smtp_id" | "created_at" | "customer_id"> & {
  customer_id?: number | null;
};

/** Where a customer's mail comes from, and what else it could come from. */
export interface Sender {
  /** The address in force, or null when nothing can be sent. */
  from: string | null;
  /** Why not, when `from` is null. */
  reason: string | null;
  /** Whether their own server is the one carrying it. */
  own_in_use: boolean;
  /** Their switch — whether they have chosen to use their own. */
  use_own: boolean;
  /** Their own address, if they have a server. */
  own: string | null;
  /** What that server is called — "POPO SMTP". */
  own_name: string | null;
  own_address: string | null;
  own_active: boolean;
  /** The address SmartDoc gave them, if any. */
  smartdoc: string | null;
  smartdoc_name: string | null;
  smartdoc_address: string | null;
  smartdoc_active: boolean;
}

export const isSmartDocAccount = (a: SmtpAccount) =>
  a.customer_id === null || a.customer_id === undefined;

export const smtpService = {
  /** Every account, SmartDoc's and every customer's. Sysadmin only. */
  async list(): Promise<SmtpAccount[]> {
    const token = await authService.ensureValidToken();
    const response = await fetch(`${API_URL}/smtp_account/`, { headers: jsonHeaders(token) });
    if (!response.ok) throw new Error(await extractMessage(response, "Failed to read the accounts"));
    return (await response.json()).data || [];
  },

  /**
   * One customer's own — none, or one.
   *
   * A customer administrator always gets their own, whatever id is passed:
   * the server ignores it for them.
   */
  async own(customerId: number): Promise<SmtpAccount[]> {
    const token = await authService.ensureValidToken();
    const response = await fetch(`${API_URL}/smtp_account/customer/${customerId}`, {
      headers: jsonHeaders(token),
    });
    if (!response.ok) throw new Error(await extractMessage(response, "Failed to read the account"));
    return (await response.json()).data || [];
  },

  /**
   * What this customer could send through, and what is carrying their mail
   * now.
   *
   * **Addresses only** — never the host or username of SmartDoc's relay.
   * `from` is null when nothing can be sent, and `reason` says why.
   */
  async resolved(): Promise<Sender> {
    const token = await authService.ensureValidToken();
    const response = await fetch(`${API_URL}/smtp_account/resolved`, {
      headers: jsonHeaders(token),
    });
    if (!response.ok) throw new Error(await extractMessage(response, "Failed to read the sender"));
    return (await response.json()).data;
  },

  /**
   * Send through their own server, or through the one SmartDoc gave them.
   *
   * Theirs to decide: the alternative was deleting their server to go back
   * to SmartDoc's.
   */
  async setUseOwn(useOwn: boolean): Promise<void> {
    const token = await authService.ensureValidToken();
    const response = await fetch(`${API_URL}/smtp_account/use_own`, {
      method: "PUT",
      headers: jsonHeaders(token),
      body: JSON.stringify({ use_own: useOwn ? 1 : 0 }),
    });
    if (!response.ok) throw new Error(await extractMessage(response, "Failed to change the sender"));
  },

  async create(input: Partial<NewSmtpAccount>): Promise<SmtpAccount> {
    const token = await authService.ensureValidToken();
    const response = await fetch(`${API_URL}/smtp_account/`, {
      method: "POST",
      headers: jsonHeaders(token),
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error(await extractMessage(response, "Failed to add the account"));
    return (await response.json()).data;
  },

  async update(input: Partial<SmtpAccount> & { smtp_id: number }): Promise<SmtpAccount> {
    const token = await authService.ensureValidToken();
    const response = await fetch(`${API_URL}/smtp_account/`, {
      method: "PUT",
      headers: jsonHeaders(token),
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error(await extractMessage(response, "Failed to save the account"));
    return (await response.json()).data;
  },

  /**
   * Put the password in Vault. It is not stored here and never comes back —
   * the answer says only where it went.
   */
  async setPassword(smtpId: number, password: string): Promise<void> {
    const token = await authService.ensureValidToken();
    const response = await fetch(`${API_URL}/smtp_account/password`, {
      method: "POST",
      headers: jsonHeaders(token),
      body: JSON.stringify({ smtp_id: smtpId, password }),
    });
    if (!response.ok) throw new Error(await extractMessage(response, "Failed to store the password"));
  },

  /** Whether a password is stored. Never its value. */
  async passwordStatus(smtpId: number): Promise<{ ok: boolean; reason: string | null }> {
    const token = await authService.ensureValidToken();
    const response = await fetch(`${API_URL}/smtp_account/${smtpId}/password`, {
      headers: jsonHeaders(token),
    });
    if (!response.ok) throw new Error(await extractMessage(response, "Failed to check the password"));
    return (await response.json()).data;
  },

  /**
   * Open a connection and say what happened.
   *
   * **It proves the host, the port and the password, and nothing else.**
   * Whether mail from this address is accepted at the far end is the SPF and
   * DKIM records on the sending domain, which belong to whoever owns the
   * address.
   */
  async test(smtpId: number): Promise<{ ok: boolean; reason: string | null }> {
    const token = await authService.ensureValidToken();
    const response = await fetch(`${API_URL}/smtp_account/${smtpId}/test`, {
      method: "POST",
      headers: jsonHeaders(token),
    });
    if (!response.ok) throw new Error(await extractMessage(response, "Failed to test the account"));
    return (await response.json()).data;
  },

  async remove(smtpId: number): Promise<void> {
    const token = await authService.ensureValidToken();
    const response = await fetch(`${API_URL}/smtp_account/${smtpId}`, {
      method: "DELETE",
      headers: jsonHeaders(token),
    });
    if (!response.ok) throw new Error(await extractMessage(response, "Failed to remove the account"));
  },
};
