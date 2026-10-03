const UPLOAD_API_URL = import.meta.env.VITE_UPLOAD_API_URL;
// Reordering is a database change, so it goes to smartdoc_api rather than the
// upload service.
const API_URL = import.meta.env.VITE_API_URL;

export interface UploadUrlRequest {
  project_id: number;
  identifier_id: number;
  files: Array<{
    originalname: string;
    size: number;
    mimetype: string;
  }>;
}

export interface UploadUrl {
  originalname: string;
  objectKey: string;
  signedUrl: string;
  size: number;
  mimetype: string;
  expiresAt: string;
}

export interface UploadUrlsResponse {
  project_id: number;
  identifier_id: number;
  uploads: UploadUrl[];
  message: string;
}

// One document the db service gave up on, as the dead-letter queue holds it.
export interface DeadLetter {
  objectKey: string;
  originalName: string | null;
  projectId: number | null;
  identifierId: number | null;
  assignmentId: number | null;
  sequence: number | null;
  timestamp: string | null;
  attempts: number | null;
  error: string | null;
}

// The upload queue as a whole: how many documents are waiting to be
// recorded, and whether anything is reading them. `consumers: 0` with
// anything waiting means the db service's channel has died — a different
// failure from a dead-lettered message, and one no retry can fix.
export interface QueueHealth {
  waiting: number;
  consumers: number;
}

export interface UploadAttribute {
  attribute_id: number;
  attribute_value: string;
}

export const uploadService = {
  // Short-lived URLs for many stored documents, in one round trip. A grid
  // signs a page of tiles at a time rather than one request per document.
  async getDownloadUrls(
    objectKeys: string[],
    accessToken: string
  ): Promise<Map<string, string>> {
    if (objectKeys.length === 0) return new Map();

    // The service signs at most 200 keys at a time — each is a signed link,
    // and a few hundred at once is what the cap is for. A long file is
    // asked for in runs rather than refused with "Too many keys", which is
    // a limit of the call and nothing the person did.
    const PER_REQUEST = 200;
    if (objectKeys.length > PER_REQUEST) {
      const all = new Map<string, string>();
      for (let at = 0; at < objectKeys.length; at += PER_REQUEST) {
        const run = await this.getDownloadUrls(
          objectKeys.slice(at, at + PER_REQUEST),
          accessToken
        );
        for (const [key, url] of run) all.set(key, url);
      }
      return all;
    }

    const response = await fetch(`${UPLOAD_API_URL}/s3/download-urls`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ objectKeys }),
    });

    if (!response.ok) {
      throw new Error("Failed to get download links");
    }

    const body = await response.json();
    const urls = new Map<string, string>();
    (body.data?.urls || []).forEach((row: { objectKey: string; signedUrl: string | null }) => {
      if (row.signedUrl) urls.set(row.objectKey, row.signedUrl);
    });
    return urls;
  },

  // A short-lived URL for viewing one stored document. The browser fetches
  // the bytes straight from storage; this service only signs the request.
  async getDownloadUrl(objectKey: string, accessToken: string): Promise<string> {
    const response = await fetch(
      `${UPLOAD_API_URL}/s3/download-url?objectKey=${encodeURIComponent(objectKey)}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!response.ok) {
      throw new Error("Failed to get a download link");
    }

    const body = await response.json();
    return body.data?.signedUrl;
  },

  /**
   * Upload links for a batch of files.
   *
   * The service answers for at most 100 at a time, so a bigger batch is
   * asked for in runs of 100 and the answers joined. It used to be sent as
   * one request, and a 120-page file came back as "Cannot request more than
   * 100 files at once" — a limit of the call, told to somebody as though
   * their documents were the problem.
   *
   * The runs go one after another, not all at once: each one is a signed
   * link per file, and a hundred of those arriving together is what the
   * limit exists to prevent.
   */
  async requestUploadUrls(
    projectId: number,
    identifierId: number,
    files: File[],
    accessToken: string
  ): Promise<UploadUrlsResponse> {
    const PER_REQUEST = 100;

    if (files.length > PER_REQUEST) {
      const runs: File[][] = [];
      for (let at = 0; at < files.length; at += PER_REQUEST) {
        runs.push(files.slice(at, at + PER_REQUEST));
      }

      let first: UploadUrlsResponse | null = null;
      const uploads: UploadUrl[] = [];

      for (const run of runs) {
        const answer = await this.requestUploadUrls(
          projectId,
          identifierId,
          run,
          accessToken
        );
        // The links are what differs between the runs; everything else is
        // the same answer about the same file, so the first one stands.
        if (!first) first = answer;
        uploads.push(...answer.uploads);
      }

      return { ...(first as UploadUrlsResponse), uploads };
    }

    const fileData = files.map((file) => ({
      originalname: file.name,
      mimetype: file.type,
      size: file.size,
      localPath: null, // Not available in browser for security reasons
    }));

    const response = await fetch(`${UPLOAD_API_URL}/upload/request-urls`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        project_id: projectId.toString(),
        identifier_id: identifierId.toString(),
        files: fileData,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to request upload URLs: ${error}`);
    }

    const response_data = await response.json();
    console.log('Upload URLs response:', response_data);

    // Handle both direct and wrapped response formats
    const uploadData = response_data.data || response_data;

    if (!uploadData.uploads) {
      throw new Error(`Invalid response: missing uploads field. Response: ${JSON.stringify(response_data)}`);
    }

    return uploadData;
  },

  async uploadFileToS3(signedUrl: string, file: File): Promise<void> {
    const response = await fetch(signedUrl, {
      method: "PUT",
      headers: {
        "Content-Type": file.type,
      },
      body: file,
    });

    if (!response.ok) {
      throw new Error(`Failed to upload file: ${file.name}`);
    }
  },

  async confirmUpload(
    objectKey: string,
    originalName: string,
    projectId: number,
    identifierId: number,
    fileSize: number,
    accessToken: string,
    assignmentId?: string,
    attributes?: UploadAttribute[],
    // Where this page sits in the batch: 1, 2, 3… in the order the files
    // were picked. Sent from here because this is the only place that knows
    // that order — by the time the row is created, the queue may have
    // reordered things.
    sequence?: number,
  ): Promise<void> {
    const response = await fetch(`${UPLOAD_API_URL}/upload/confirm`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        objectKey,
        originalName,
        projectId,
        identifierId,
        fileSize,
        assignmentId,
        attributes,
        sequence,
      }),
    });

    if (!response.ok) {
      throw new Error("Failed to confirm upload");
    }
  },

  /**
   * Sign a PUT over a document that is already stored, so an edited version
   * can replace it in place rather than arriving as a second copy. The
   * thumbnail is signed with it — nothing regenerates thumbnails after the
   * first pass, so an edited page would otherwise keep showing the old
   * picture in every grid.
   */
  async getReplaceUrls(
    objectKey: string,
    contentType: string,
    accessToken: string,
  ): Promise<{ signedUrl: string; thumbSignedUrl: string }> {
    const response = await fetch(`${UPLOAD_API_URL}/s3/replace-urls`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ objectKey, contentType }),
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body?.data?.signedUrl) {
      throw new Error(body?.error || "Failed to prepare the document for replacing");
    }

    return { signedUrl: body.data.signedUrl, thumbSignedUrl: body.data.thumbSignedUrl };
  },

  /** Save the order of a batch, sent whole. */
  async reorderBatch(
    assignmentId: number,
    imageIds: number[],
    accessToken: string,
  ): Promise<void> {
    const response = await fetch(`${API_URL}/image/order`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ assignment_id: assignmentId, image_ids: imageIds }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body?.message || "Failed to save the order");
    }
  },

  /**
   * Put a document back on the enhance or analyze queue.
   *
   * Those stages record a failure against the document and stop, rather than
   * dead-lettering into a queue nobody watches. This is how someone asks for
   * another go once whatever broke has been fixed.
   */
  async retryStage(
    stage: "enhance" | "analyze" | "ocr",
    input: {
      imageId: number;
      objectKey: string;
      projectId: number;
      identifierId: number;
      originalName?: string;
    },
    accessToken: string,
  ): Promise<void> {
    const response = await fetch(`${UPLOAD_API_URL}/pipeline/retry`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ stage, ...input }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body?.error || "Failed to ask for another go");
    }
  },

  /**
   * What the db service gave up on: documents stored but never recorded,
   * as the dead-letter queue holds them. Narrowed to a batch or a project.
   * `error` is the last reason the db service saw — a token, a service
   * being down, a bad message — which is what tells somebody what to fix.
   */
  async getDeadLetters(
    filter: { assignmentId?: number; projectId?: number },
    accessToken: string,
  ): Promise<{ messages: DeadLetter[]; queue: QueueHealth }> {
    const params = new URLSearchParams();
    if (filter.assignmentId) params.set("assignmentId", String(filter.assignmentId));
    if (filter.projectId) params.set("projectId", String(filter.projectId));

    const response = await fetch(`${UPLOAD_API_URL}/pipeline/dlq?${params.toString()}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      throw new Error("Could not check the upload queue");
    }

    const body = await response.json();
    return {
      messages: body.data?.messages || [],
      queue: body.data?.queue || { waiting: 0, consumers: 0 },
    };
  },

  /** Try the stuck documents again — a batch's, a project's, or one file. */
  async requeueDeadLetters(
    filter: { assignmentId?: number; projectId?: number; objectKey?: string },
    accessToken: string,
  ): Promise<number> {
    const response = await fetch(`${UPLOAD_API_URL}/pipeline/dlq/requeue`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(filter),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body?.error || "Could not retry the stuck documents");
    }

    const body = await response.json();
    return Number(body.data?.requeued) || 0;
  },

  /** Put new bytes at a URL signed by getReplaceUrls. */
  async putSignedBlob(signedUrl: string, blob: Blob): Promise<void> {
    const response = await fetch(signedUrl, {
      method: "PUT",
      headers: { "Content-Type": blob.type },
      body: blob,
    });

    if (!response.ok) {
      throw new Error(`Storage refused the upload (${response.status})`);
    }
  },
};
