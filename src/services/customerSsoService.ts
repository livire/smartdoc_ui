import { authService } from "./authService";

const API_URL = import.meta.env.VITE_API_URL;

/**
 * A customer's single sign-on, through `smartdoc_api` — system
 * administrators only. Everything is held by Keycloak; nothing here is
 * stored by SmartDoc.
 */
export interface CustomerSso {
  alias: string;
  configured: boolean;
  /** What the customer's IT team enters in their Entra or Okta. Always given. */
  return_url: string;
  name?: string | null;
  domains?: string[];
  enabled?: boolean;
  discovery_url?: string | null;
  client_id?: string | null;
  /** Whether a client secret is stored. The secret itself never comes back. */
  has_secret?: boolean;
}

export interface CustomerSsoInput {
  domains: string;
  discovery_url: string;
  client_id: string;
  /** Required the first time; leave empty to keep the stored one. */
  client_secret?: string;
  enabled: boolean;
}

const headers = async () => ({
  Authorization: `Bearer ${await authService.ensureValidToken()}`,
  "Content-Type": "application/json",
});

// The server's own words — "gmail.com belongs to everybody", "acme.com is
// already used by …" — say exactly what to change.
const answer = async (response: Response, fallback: string): Promise<CustomerSso> => {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.message || fallback);
  return body.data as CustomerSso;
};

export const customerSsoService = {
  async get(customerId: number): Promise<CustomerSso> {
    const response = await fetch(`${API_URL}/customer/${customerId}/sso`, { headers: await headers() });
    return answer(response, "Could not read the single sign-on settings");
  },

  async save(customerId: number, input: CustomerSsoInput): Promise<CustomerSso> {
    const response = await fetch(`${API_URL}/customer/${customerId}/sso`, {
      method: "PUT",
      headers: await headers(),
      body: JSON.stringify({
        domains: input.domains,
        discovery_url: input.discovery_url.trim(),
        client_id: input.client_id.trim(),
        enabled: input.enabled,
        ...(input.client_secret?.trim() ? { client_secret: input.client_secret.trim() } : {}),
      }),
    });
    return answer(response, "Could not save the single sign-on settings");
  },

  async remove(customerId: number): Promise<CustomerSso> {
    const response = await fetch(`${API_URL}/customer/${customerId}/sso`, {
      method: "DELETE",
      headers: await headers(),
    });
    return answer(response, "Could not remove single sign-on");
  },
};
