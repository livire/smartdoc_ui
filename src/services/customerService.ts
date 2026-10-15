import { cached, FOREVER, forget } from "./cache";
const API_BASE_URL = import.meta.env.VITE_API_URL;

export interface CustomerDetails {
  customer_id: number;
  customer_name: string;
  is_active: number;
  // Not in the public answer the sign-in page reads (`getCustomerByUrl`), so
  // a customer stored at sign-in has none of the fields below. A screen that
  // needs one reads the row with `getById` and the person's own token.
  allowed_projects?: number;
  /** Whether SmartDoc has agreed this customer may add AI models. */
  can_add_models?: 0 | 1;
  /**
   * Whether SmartDoc has agreed this customer may send their people's mail
   * through their own server. Without one, password links come from
   * SmartDoc's address.
   */
  can_add_smtp?: 0 | 1;
  /**
   * Which of SmartDoc's email accounts sends this customer's mail. **Null is
   * the default one.** An account of their own, when they have one, is used
   * ahead of this.
   */
  smtp_id?: number | null;
  /**
   * Whether their mail goes through their own server rather than the one
   * SmartDoc gave them. On by default; means nothing without a server of
   * their own. **The customer sets this, not SmartDoc** — it is their
   * server.
   */
  use_own_smtp?: 0 | 1;
  customer_url: string;
}

// A customer with the size of it, for the system screen.
export interface CustomerSummary extends CustomerDetails {
  projects: number;
  users: number;
  cadmins: number;
  // Memberships, not people: one person can be admin on one project and a
  // worker on another.
  admins: number;
  workers: number;
}

/** How a customer's SmartDoc looks. Null when not set. */
export interface CustomerBranding {
  customer_label: string | null;
  login_logo: string | null;
  menu_logo: string | null;
  // The same marks for a dark screen. Null falls back to the light ones.
  login_logo_dark: string | null;
  menu_logo_dark: string | null;
}

/**
 * What anybody may see about a customer, signed in or not. The password
 * rules are here because the sign-in form shows them before anybody types;
 * null means the customer has not set them.
 */
export type PublicCustomer = Pick<
  CustomerDetails,
  "customer_id" | "customer_name" | "customer_url" | "is_active"
> &
  CustomerBranding & {
    password_min_length: number | null;
    password_needs_digit: 0 | 1 | null;
    password_needs_symbol: 0 | 1 | null;
    password_needs_capital: 0 | 1 | null;
    /** Their company login's alias when single sign-on is on, else null. */
    company_login: string | null;
    /** True when whether they have one could not be checked just now. */
    company_login_unknown: boolean;
  };

export interface CustomerResponse {
  data: PublicCustomer;
}

export const customerService = {
  /**
   * One customer, by the url they sign in at: name, active, and logos.
   *
   * **No token** — `smartdoc_api`'s `GET /public/customer/:url`. The sign-in
   * page needs this before anybody has signed in. It used to fetch
   * `auth_api`'s service token for it, which handed that token to every
   * browser (`known-issues.md`, 2026-10-14).
   *
   * Cached for the life of the tab: the sign-in page, its form and the
   * sidebar all ask, and Customer Settings clears it after a save.
   */
  async getCustomerByUrl(customerUrl: string): Promise<CustomerResponse> {
    return cached(`customer:${customerUrl}`, FOREVER, () =>
      this.fetchCustomerByUrl(customerUrl)
    );
  },

  /** Forget a cached customer — after its branding or settings are saved. */
  forgetCustomer(customerUrl: string) {
    forget(`customer:${customerUrl}`);
  },

  async fetchCustomerByUrl(
    customerUrl: string
  ): Promise<CustomerResponse> {
    const response = await fetch(
      `${API_BASE_URL}/public/customer/${encodeURIComponent(customerUrl)}`
    );

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error("Customer URL not found. Please check the customer ID.");
      }
      throw new Error(`Failed to fetch customer: ${response.statusText}`);
    }

    const data = await response.json();

    if (!data || !data.data || data.data === null) {
      throw new Error("Customer not found. Please check the customer ID.");
    }

    return data;
  },

  /**
   * Every customer in the system.
   *
   * Only somebody who runs SmartDoc may ask — the API refuses everyone else
   * — so this takes their own token.
   */
  async getAll(accessToken: string): Promise<CustomerSummary[]> {
    const response = await fetch(`${API_BASE_URL}/customer/summary`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error("Failed to fetch customers");
    }

    const body = await response.json();
    return body.data || [];
  },

  /** Start a customer off: a name and the url its people will sign in at. */
  async createCustomer(
    input: { customer_name: string; customer_url: string; allowed_projects: number },
    accessToken: string,
  ): Promise<CustomerDetails> {
    const response = await fetch(`${API_BASE_URL}/customer/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...input, is_active: 1 }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body?.message || "Failed to create the customer");
    }

    const body = await response.json();
    return body.data?.data ?? body.data;
  },

  /**
   * Change a customer's own row: name, address, project limit, active.
   *
   * System administrators only. The limit may come down, but the server
   * refuses to set it below the projects the customer already has.
   */
  async updateCustomer(
    input: {
      customer_id: number;
      customer_name: string;
      customer_url: string;
      allowed_projects: number;
      is_active: number;
      /**
       * Whether this customer may add AI models of their own. Omit to leave
       * it alone — the server only writes it when it is sent.
       */
      can_add_models?: 0 | 1;
      /** The same for their own email server. Omit to leave it alone. */
      can_add_smtp?: 0 | 1;
      /** Which SmartDoc email account sends their mail; null is the default. */
      smtp_id?: number | null;
    },
    accessToken: string,
  ): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/customer/`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body?.message || "Failed to update the customer");
    }
  },

  validateCustomer(customer: Pick<CustomerDetails, "is_active">): boolean {
    return customer.is_active === 1;
  },

  /**
   * The customer to keep for the session, without the logos. Stored in
   * localStorage, where a logo is tens of kilobytes; screens get the logos
   * from `getCustomerByUrl` or `getSettings`.
   */
  withoutBranding(customer: PublicCustomer): CustomerDetails {
    return {
      customer_id: customer.customer_id,
      customer_name: customer.customer_name,
      customer_url: customer.customer_url,
      is_active: customer.is_active,
    };
  },

  // Kept between visits: a logo is a data URL of tens of kilobytes, and
  // fetching it on every screen that shows it meant a request and a
  // visible blank while it happened. Stored per customer,
  // so switching customers cannot show the wrong one.
  cacheKey(customerId: number) {
    return `smartdoc.customer_settings.${customerId}`;
  },

  /**
   * The cached settings for whichever customer is stored, without waiting for
   * CustomerContext.
   *
   * That context fills itself from localStorage in an effect, so on the very
   * first render it is still null — screens reading the cache through it drew
   * a placeholder before they drew the logo. This reads the same key the
   * context reads.
   */
  readCachedSettingsForStoredCustomer() {
    try {
      const stored = localStorage.getItem("customer_data");
      const customerId = stored ? JSON.parse(stored)?.customer_id : null;
      return customerId ? this.readCachedSettings(Number(customerId)) : null;
    } catch {
      return null;
    }
  },

  /** What we already know, with no request. Null when nothing is cached. */
  readCachedSettings(customerId: number): {
    customer_label: string | null;
    login_logo: string | null;
    menu_logo: string | null;
    // The same marks for a dark screen. Null falls back to the light ones.
    login_logo_dark?: string | null;
    menu_logo_dark?: string | null;
    idle_timeout_minutes?: number;
    password_min_length?: number;
    password_needs_digit?: 0 | 1;
    password_needs_symbol?: 0 | 1;
    password_needs_capital?: 0 | 1;
  } | null {
    try {
      const raw = localStorage.getItem(this.cacheKey(customerId));
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },

  writeCachedSettings(customerId: number, settings: unknown) {
    try {
      localStorage.setItem(this.cacheKey(customerId), JSON.stringify(settings));
    } catch {
      // A browser refusing storage just means fetching it again next time.
    }
  },

  /**
   * One customer's row — the name, the limits, and whether SmartDoc has
   * agreed they may add AI models.
   *
   * Separate from `getSettings`, which reads `customer_setting`: the two are
   * different tables answering different questions, and a screen that needs
   * `can_add_models` was otherwise reading the whole customer list to find
   * one row.
   */
  async getById(customerId: number, accessToken: string): Promise<CustomerDetails | null> {
    const response = await fetch(`${API_BASE_URL}/customer/${customerId}`, {
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    });
    if (!response.ok) return null;
    const body = await response.json();
    return body.data ?? null;
  },

  /**
   * Everything in `customer_setting` — logos, limits, password rules, the
   * idle timeout, AI models. **Signed-in screens only**: it takes the
   * person's own token. Before sign-in, `getCustomerByUrl` has the logos.
   */
  async getSettings(customerId: number, accessToken: string): Promise<{
    customer_label: string | null;
    login_logo: string | null;
    menu_logo: string | null;
    // The same marks for a dark screen. Null falls back to the light ones.
    login_logo_dark?: string | null;
    menu_logo_dark?: string | null;
    max_file_mb?: number;
    // Minutes without a key or a click before the session is left to lapse.
    idle_timeout_minutes?: number;
    // What a password must look like for this customer's people.
    password_min_length?: number;
    password_needs_digit?: 0 | 1;
    password_needs_symbol?: 0 | 1;
    password_needs_capital?: 0 | 1;
    // The customer's default model per purpose, from the /sys catalogue.
    categorise_model_id?: number | null;
    read_model_id?: number | null;
  } | null> {
    const response = await fetch(`${API_BASE_URL}/customer_setting/customer/${customerId}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) return null;
    const body = await response.json();
    const settings = body.data ?? null;
    if (settings) this.writeCachedSettings(customerId, settings);
    return settings;
  },

  // Saving is done by a signed-in admin, so it uses their token.
  async saveSettings(
    customerId: number,
    input: {
      customer_label?: string;
      login_logo?: string;
      menu_logo?: string;
      login_logo_dark?: string;
      menu_logo_dark?: string;
      max_file_mb?: number;
      idle_timeout_minutes?: number;
      password_min_length?: number;
      password_needs_digit?: 0 | 1;
      password_needs_symbol?: 0 | 1;
      password_needs_capital?: 0 | 1;
      categorise_model_id?: number | null;
      read_model_id?: number | null;
    },
    accessToken: string,
  ): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/customer_setting/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ customer_id: customerId, ...input }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body?.message || "Failed to save the customer settings");
    }

    // The screens read from the cache first, so a save that did not update it
    // would show the old logo until something else refreshed it.
    const current = this.readCachedSettings(customerId) ?? {
      customer_label: null,
      login_logo: null,
      menu_logo: null,
      login_logo_dark: null,
      menu_logo_dark: null,
    };
    this.writeCachedSettings(customerId, { ...current, ...input });
  },
};
