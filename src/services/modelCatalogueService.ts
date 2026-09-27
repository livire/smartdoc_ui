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

/** What a model is for. Two jobs, and a model may be listed for each. */
// The two jobs a model can be chosen for. A job, not a kind of model —
// the catalogue lists a model once and the same one can do either.
export type ModelPurpose = "categorise" | "read";

/**
 * Engines that run inside SmartDoc and need no API key.
 *
 * Tesseract reads in smartdoc_ocr_service's own container, so there is
 * nobody to pay and nothing to authenticate. Without this the screen would
 * show it as "Key: Not set" for ever — reporting a fault that does not
 * exist. smartdoc_api keeps the same list; it is the one that enforces it.
 */
const KEYLESS_PROVIDERS = ["tesseract"];

export const providerNeedsKey = (provider: string) =>
  !KEYLESS_PROVIDERS.includes(provider.toLowerCase());

export interface CatalogueModel {
  model_id: number;
  provider: string;
  // What is sent to the provider — "gpt-4o".
  model_name: string;
  // What people read — "GPT-4o".
  display_name: string;
  is_offered: 0 | 1;
  is_active: 0 | 1;
  endpoint: string;
  created_at: string;
  // Only on a project's settings: which of the two levels chose it.
  source?: "project" | "customer";
}

export const modelCatalogueService = {
  /** The whole catalogue, including what is retired. Sysadmin only. */
  async list(): Promise<CatalogueModel[]> {
    const token = await authService.ensureValidToken();
    const response = await fetch(`${API_URL}/model_catalogue/`, { headers: jsonHeaders(token) });
    if (!response.ok) throw new Error(await extractMessage(response, "Failed to read the models"));
    return (await response.json()).data || [];
  },

  /** What a customer may choose from. */
  async offered(): Promise<CatalogueModel[]> {
    const token = await authService.ensureValidToken();
    const response = await fetch(`${API_URL}/model_catalogue/offered`, {
      headers: jsonHeaders(token),
    });
    if (!response.ok) throw new Error(await extractMessage(response, "Failed to read the models"));
    return (await response.json()).data || [];
  },

  async create(input: Partial<CatalogueModel>): Promise<CatalogueModel> {
    const token = await authService.ensureValidToken();
    const response = await fetch(`${API_URL}/model_catalogue/`, {
      method: "POST",
      headers: jsonHeaders(token),
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error(await extractMessage(response, "Failed to add the model"));
    return (await response.json()).data;
  },

  async update(input: Partial<CatalogueModel> & { model_id: number }): Promise<CatalogueModel> {
    const token = await authService.ensureValidToken();
    const response = await fetch(`${API_URL}/model_catalogue/`, {
      method: "PUT",
      headers: jsonHeaders(token),
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error(await extractMessage(response, "Failed to save the model"));
    return (await response.json()).data;
  },

  /**
   * Put the key in Vault. It is not stored here and never comes back — the
   * answer says only where it went.
   */
  async setKey(modelId: number, apiKey: string): Promise<void> {
    const token = await authService.ensureValidToken();
    const response = await fetch(`${API_URL}/model_catalogue/key`, {
      method: "POST",
      headers: jsonHeaders(token),
      body: JSON.stringify({ model_id: modelId, api_key: apiKey }),
    });
    if (!response.ok) throw new Error(await extractMessage(response, "Failed to store the key"));
  },

  async verifyKey(modelId: number): Promise<{ ok: boolean; reason: string | null }> {
    const token = await authService.ensureValidToken();
    const response = await fetch(`${API_URL}/model_catalogue/${modelId}/key`, {
      headers: jsonHeaders(token),
    });
    if (!response.ok) throw new Error(await extractMessage(response, "Failed to check the key"));
    return (await response.json()).data;
  },
};

/** What a project still needs before it can take documents. */
export interface ProjectReadiness {
  ready: boolean;
  reasons: string[];
}

export const projectReadinessService = {
  async check(projectId: number): Promise<ProjectReadiness> {
    const token = await authService.ensureValidToken();
    const response = await fetch(`${API_URL}/project/${projectId}/readiness`, {
      headers: jsonHeaders(token),
    });
    if (!response.ok) throw new Error(await extractMessage(response, "Failed to check the project"));
    return (await response.json()).data;
  },
};
