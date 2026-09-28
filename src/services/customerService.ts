const API_BASE_URL = import.meta.env.VITE_API_URL;
const AUTH_API_URL = import.meta.env.VITE_AUTH_API_URL;

export interface CustomerDetails {
  customer_id: number;
  customer_name: string;
  is_active: number;
  allowed_projects: number;
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

export interface CustomerResponse {
  data: CustomerDetails;
}

export interface ServiceTokenResponse {
  data: {
    access_token: string;
    token_expiry: number;
    token_type: string;
  };
}

let cachedServiceToken: string | null = null;
let serviceTokenExpiry: number | null = null;

export const customerService = {
  async getServiceToken(): Promise<string> {
    // Return cached token if still valid
    if (cachedServiceToken && serviceTokenExpiry && Date.now() < serviceTokenExpiry) {
      return cachedServiceToken;
    }

    const response = await fetch(`${AUTH_API_URL}/service_token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error("Failed to get service token");
    }

    const data: ServiceTokenResponse = await response.json();
    cachedServiceToken = data.data.access_token;
    serviceTokenExpiry = data.data.token_expiry;

    return cachedServiceToken;
  },

  async getCustomerByUrl(
    customerUrl: string
  ): Promise<CustomerResponse> {
    const token = await this.getServiceToken();

    const response = await fetch(
      `${API_BASE_URL}/customer/url/${customerUrl}`,
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
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
   * — so this takes their own token rather than the service token the
   * sign-in page uses.
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

  validateCustomer(customer: CustomerDetails): boolean {
    return customer.is_active === 1;
  },

  // Kept between visits: a logo is a data URL of tens of kilobytes, and
  // fetching it on every screen that shows it meant a service token, a
  // request, and a visible blank while both happened. Stored per customer,
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
    idle_timeout_minutes?: number;
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

  // How this customer's SmartDoc looks: the label and the two logos.
  // Read with the service token, because the sign-in page needs it before
  // anybody has one of their own.
  async getSettings(customerId: number): Promise<{
    customer_label: string | null;
    login_logo: string | null;
    menu_logo: string | null;
    max_file_mb?: number;
    // Minutes without a key or a click before the session is left to lapse.
    idle_timeout_minutes?: number;
    // The customer's default model per purpose, from the /sys catalogue.
    categorise_model_id?: number | null;
    read_model_id?: number | null;
  } | null> {
    const token = await this.getServiceToken();

    const response = await fetch(`${API_BASE_URL}/customer_setting/customer/${customerId}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
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
      max_file_mb?: number;
      idle_timeout_minutes?: number;
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
    };
    this.writeCachedSettings(customerId, { ...current, ...input });
  },
};
