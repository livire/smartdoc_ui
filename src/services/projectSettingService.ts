const API_URL = import.meta.env.VITE_API_URL;

const extractMessage = async (response: Response, fallback: string) => {
  try {
    const body = await response.json();
    return body?.message || fallback;
  } catch {
    return fallback;
  }
};

export interface ProjectSetting {
  project_setting_id: number;
  project_id: number;
  auto_process: 0 | 1;
  auto_analyze: 0 | 1;
  auto_ocr: 0 | 1;
  auto_verify: 0 | 1;
  allow_self_verify: 0 | 1;
  // Whether a worker may give themselves a batch on the Digitize screen,
  // rather than waiting for one to be handed out.
  allow_self_assign: 0 | 1;
  // The largest a single document may be on this project, in megabytes —
  // or null, meaning "whatever the customer says". Null is the ordinary
  // case; a project carries a number only when it needs to differ.
  max_file_mb: number | null;
  // What actually applies, and which of the two said it. Resolved by the
  // API so no screen has to repeat the rule. Read-only.
  max_file_mb_effective?: number;
  max_file_mb_source?: "project" | "customer";
  // This project's own models, or null meaning "whatever the customer
  // says" — the same shape as max_file_mb.
  categorise_model_id: number | null;
  read_model_id: number | null;
  // What actually applies, resolved by the API, with `source` saying which
  // level chose it. Read-only.
  categorise_model?: { model_id: number; display_name: string; source: "project" | "customer" } | null;
  read_model?: { model_id: number; display_name: string; source: "project" | "customer" } | null;
  // Which of the customer's storages this project uses.
  customer_storage_id: number;
  // Flattened from that storage by the API — read-only here. The pipeline
  // services read these same fields, which is why they never had to learn
  // that storage moved to its own table.
  storage_name?: string;
  storage_provider?: "aws" | "minio";
  s3_bucket?: string;
  s3_endpoint?: string | null;
  s3_region?: string;
  vault_path?: string;
}

export const projectSettingService = {
  // Returns null when a project has no settings row yet — a project created
  // before this screen existed, or one whose setup was never finished.
  async getByProject(projectId: number, accessToken: string): Promise<ProjectSetting | null> {
    const response = await fetch(`${API_URL}/project_setting/project/${projectId}`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(await extractMessage(response, "Failed to fetch project settings"));
    }

    const body = await response.json();
    return body.data || null;
  },

  // Every flag is NOT NULL with no DB default, so all of them go on create.
  // customer_storage_id is required too: the API refuses a project that
  // doesn't say where its documents live.
  async create(
    input: Omit<ProjectSetting, "project_setting_id">,
    accessToken: string
  ): Promise<ProjectSetting> {
    const response = await fetch(`${API_URL}/project_setting/`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      throw new Error(await extractMessage(response, "Failed to create project settings"));
    }

    const body = await response.json();
    return body.data;
  },

  // Writes only the fields present in the payload.
  //
  // Two refusals worth surfacing verbatim to the user, both from the API:
  // a storage belonging to a different customer, and changing storage on a
  // project that already holds documents (409) — the objects are not moved,
  // so every existing document would point at a bucket it was never in.
  async update(
    input: Partial<ProjectSetting> & { project_setting_id: number },
    accessToken: string
  ): Promise<ProjectSetting> {
    const response = await fetch(`${API_URL}/project_setting/`, {
      method: "PUT",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      throw new Error(await extractMessage(response, "Failed to update project settings"));
    }

    const body = await response.json();
    return body.data?.data;
  },
};
