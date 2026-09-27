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

export interface ProjectApiKey {
  project_api_key_id: number;
  project_id: number;
  // The first and last few characters — enough to tell two keys apart, and
  // no use to anybody. The key itself is shown once, when it is issued, and
  // is never stored.
  key_label: string;
  purpose: string;
  created_by: number | null;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
}

// What an outside system sent, and what became of it.
export interface IdentifierPush {
  identifier_push_log_id: number;
  identifier_value: string | null;
  // 201 created · 409 already there · 400 bad value · 401 bad key · 429 too many
  outcome: number;
  identifier_id: number | null;
  message: string | null;
  source_ip: string | null;
  created_at: string;
}

export const projectApiKeyService = {
  async list(projectId: number): Promise<ProjectApiKey[]> {
    const token = await authService.ensureValidToken();
    const response = await fetch(`${API_URL}/project_api_key/project/${projectId}`, {
      headers: jsonHeaders(token),
    });
    if (!response.ok) throw new Error(await extractMessage(response, "Failed to read the keys"));
    const body = await response.json();
    return body.data || [];
  },

  /**
   * Issue one. The key comes back exactly once, in this answer — it is not
   * stored anywhere, so it cannot be fetched again. Show it, let it be
   * copied, and do not keep it in any state that outlives the dialog.
   */
  async issue(projectId: number, expiresAt: string | null): Promise<ProjectApiKey & { key: string }> {
    const token = await authService.ensureValidToken();
    const response = await fetch(`${API_URL}/project_api_key/`, {
      method: "POST",
      headers: jsonHeaders(token),
      body: JSON.stringify({ project_id: projectId, expires_at: expiresAt }),
    });
    if (!response.ok) throw new Error(await extractMessage(response, "Failed to issue a key"));
    const body = await response.json();
    return body.data;
  },

  async revoke(projectId: number, keyId: number): Promise<void> {
    const token = await authService.ensureValidToken();
    const response = await fetch(`${API_URL}/project_api_key/revoke`, {
      method: "POST",
      headers: jsonHeaders(token),
      body: JSON.stringify({ project_id: projectId, project_api_key_id: keyId }),
    });
    if (!response.ok) throw new Error(await extractMessage(response, "Failed to revoke the key"));
  },

  async pushLog(projectId: number, limit = 50): Promise<IdentifierPush[]> {
    const token = await authService.ensureValidToken();
    const response = await fetch(
      `${API_URL}/identifier/push-log/project/${projectId}?limit=${limit}`,
      { headers: jsonHeaders(token) },
    );
    if (!response.ok) throw new Error(await extractMessage(response, "Failed to read the log"));
    const body = await response.json();
    return body.data || [];
  },
};
