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
  /**
   * Who owns it. **Null is SmartDoc's**; a customer id means that customer
   * added it and only they can see or choose it.
   */
  customer_id?: number | null;
  /**
   * The day it stops working, or null for no end date.
   *
   * Setting it withdraws the model from anybody choosing now and warns
   * everybody already using it. It keeps working until the day passes.
   */
  retires_on?: string | null;
  endpoint: string;
  /**
   * What it can do. Tesseract reads and cannot categorise; most AI models
   * do both. The choosers filter on these, never on the provider's name.
   */
  can_read: 0 | 1;
  can_categorise: 0 | 1;
  created_at: string;
  // Only on a project's settings: which of the two levels chose it.
  source?: "project" | "customer";
}

/** Everything that can read a page. */
export const ocrModels = (models: CatalogueModel[]) =>
  models.filter((m) => Number(m.can_read) === 1);

/**
 * Everything that can decide what a page is. smartdoc_api refuses the
 * others on save as well — this only keeps them out of the dropdown.
 */
export const categoriseModels = (models: CatalogueModel[]) =>
  models.filter((m) => Number(m.can_categorise) === 1);

/** SmartDoc's own, as opposed to one a customer added. */
export const isSmartDocModel = (m: CatalogueModel) =>
  m.customer_id === null || m.customer_id === undefined;

/**
 * Days until a model stops, or null when it has no end date.
 *
 * Negative once the day has passed, so one answer tells "retires in 3 days"
 * from "retired 3 days ago". Compared as plain dates: turning both into
 * `Date` objects drags the browser's timezone in, and a model would retire
 * at midnight somewhere else.
 */
export const daysUntilRetired = (m: CatalogueModel): number | null => {
  if (!m.retires_on) return null;
  const day = String(m.retires_on).slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const MS = 24 * 60 * 60 * 1000;
  return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / MS);
};

export const modelCatalogueService = {
  /** The whole catalogue, including what is retired. Sysadmin only. */
  async list(): Promise<CatalogueModel[]> {
    const token = await authService.ensureValidToken();
    const response = await fetch(`${API_URL}/model_catalogue/`, { headers: jsonHeaders(token) });
    if (!response.ok) throw new Error(await extractMessage(response, "Failed to read the models"));
    return (await response.json()).data || [];
  },

  /**
   * What the signed-in person's customer may choose from.
   *
   * Scoped on the server since 2026-10-12: the SmartDoc models on their
   * allowlist, plus the ones they added themselves, minus anything past its
   * last day. It used to answer the whole catalogue to anybody.
   */
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

  /** The SmartDoc model ids this customer may choose from. */
  async allowlist(customerId: number): Promise<number[]> {
    const token = await authService.ensureValidToken();
    const response = await fetch(`${API_URL}/model_catalogue/allowlist/${customerId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(await extractMessage(response, "Failed to read the allowlist"));
    const body = await response.json();
    return body.data || [];
  },

  /** Replace it. Whoever runs SmartDoc only. */
  async setAllowlist(customerId: number, modelIds: number[]): Promise<number[]> {
    const token = await authService.ensureValidToken();
    const response = await fetch(`${API_URL}/model_catalogue/allowlist/${customerId}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model_ids: modelIds }),
    });
    if (!response.ok) throw new Error(await extractMessage(response, "Failed to save the allowlist"));
    const body = await response.json();
    return body.data || [];
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
