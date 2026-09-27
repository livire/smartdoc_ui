const API_URL = import.meta.env.VITE_API_URL;

// smartdoc_api surfaces failures as `{ message }` (see controllerHelpers.js),
// so prefer the server's own message over a generic fallback. The storage
// endpoints lean on this heavily — "storage X belongs to customer Y" and the
// Vault errors are written to be shown to a person.
const extractMessage = async (response: Response, fallback: string) => {
  try {
    const body = await response.json();
    return body?.message || fallback;
  } catch {
    return fallback;
  }
};

export type StorageProvider = "aws" | "minio";

export interface Storage {
  customer_storage_id: number;
  customer_id: number;
  storage_name: string;
  storage_provider: StorageProvider;
  s3_bucket: string;
  // NULL for AWS — the SDK derives it from the region. Required for MinIO.
  s3_endpoint: string | null;
  s3_region: string;
  // The FOLDER in Vault, e.g. "kv/data/smartdoc_storage". This row's id is
  // appended by the API to reach the secret itself.
  vault_path: string;
  is_active: 0 | 1;
  // Returned by the API, never sent: vault_path + "/" + customer_storage_id.
  // This is where the credentials must be written.
  resolved_vault_path?: string;
}

export interface StorageVerdict {
  ok: boolean;
  reason: string | null;
  vault_path: string;
}

export const storageService = {
  async getStoragesByCustomer(customerId: number, accessToken: string): Promise<Storage[]> {
    const response = await fetch(`${API_URL}/customer_storage/customer/${customerId}`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(await extractMessage(response, "Failed to fetch storages"));
    }

    const body = await response.json();
    return body.data || [];
  },

  async createStorage(
    input: Omit<Storage, "customer_storage_id" | "resolved_vault_path">,
    accessToken: string
  ): Promise<Storage> {
    const response = await fetch(`${API_URL}/customer_storage/`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      throw new Error(await extractMessage(response, "Failed to create storage"));
    }

    const body = await response.json();
    return body.data;
  },

  // PUT writes only the fields present in the payload, so a partial object is
  // safe here — unlike /category/, which replaces every column.
  async updateStorage(
    input: Partial<Storage> & { customer_storage_id: number },
    accessToken: string
  ): Promise<Storage> {
    const response = await fetch(`${API_URL}/customer_storage/`, {
      method: "PUT",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      throw new Error(await extractMessage(response, "Failed to update storage"));
    }

    const body = await response.json();
    return body.data?.data;
  },

  // Has this storage's secret been written yet? Never returns key values.
  async verifyStorage(customerStorageId: number, accessToken: string): Promise<StorageVerdict> {
    const response = await fetch(`${API_URL}/customer_storage/verify`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ customer_storage_id: customerStorageId }),
    });

    if (!response.ok) {
      throw new Error(await extractMessage(response, "Failed to check credentials"));
    }

    const body = await response.json();
    return body.data;
  },

  // Keys travel one way only. The API writes them to Vault with a token that
  // can do nothing else, and answers { ok, vault_path } — never the values.
  async setCredentials(
    customerStorageId: number,
    accessKey: string,
    secretKey: string,
    accessToken: string
  ): Promise<{ ok: boolean; vault_path: string }> {
    const response = await fetch(`${API_URL}/customer_storage/credentials`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        customer_storage_id: customerStorageId,
        s3_access_key: accessKey,
        s3_secret_key: secretKey,
      }),
    });

    if (!response.ok) {
      throw new Error(await extractMessage(response, "Failed to store credentials"));
    }

    const body = await response.json();
    return body.data;
  },
};
