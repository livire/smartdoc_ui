const API_URL = import.meta.env.VITE_API_URL;

// smartdoc_api surfaces failures as `{ message }` (see controllerHelpers.js),
// so prefer the server's own message over a generic fallback.
const extractMessage = async (response: Response, fallback: string) => {
  try {
    const body = await response.json();
    return body?.message || fallback;
  } catch {
    return fallback;
  }
};

// One page of a file, as the administration read returns it.
export interface FilePage {
  image_id: number;
  identifier_id: number;
  image_path: string;
  assignment_id: number | null;
  seq_no: number | null;
  is_active: boolean | number;
  replaces_image_id: number | null;
  image_categories?: { category?: { category_name?: string } }[];
  // The batch this page was captured in, by the label people use for it.
  assignment?: { assignment_id: number; assignment_code?: string | null };
  // What was typed against this page when it was captured — the project's
  // own fields, which the arrange screen can group by.
  image_attributes?: {
    attribute_id: number;
    attribute_value: string;
    attribute?: { attribute_name?: string };
  }[];
}

// A record that somebody rearranged a file.
export interface ArrangeRecord {
  identifier_arrange_id: number;
  identifier_id: number;
  user_id: number;
  arranged_at: string;
  moved_count: number;
  notes: string | null;
  user?: { username?: string };
}

export interface Identifier {
  identifier_id: number;
  identifier_value: string;
  project_id: number;
  // The lock — see IdentifierLock below. 0 free, 1 capture/verify,
  // 2 sequencing.
  open: 0 | 1 | 2;
  // Who holds it and since when. Null while the file is free.
  open_by?: number | null;
  opened_at?: string | null;
}

export interface IdentifiersResponse {
  data: Identifier[];
}

export interface Attribute {
  attribute_id: number;
  attribute_name: string;
  project_id: number;
  type: 'D' | 'S' | 'N';
  required: 0 | 1;
  default_value: string | null;
  length: number | null;
}

export interface AttributesResponse {
  data: Attribute[];
}

export interface Category {
  category_id: number;
  category_name: string;
  category_description: string | null;
  project_id: number;
  is_active: 0 | 1;
}

export interface CategoriesResponse {
  data: Category[];
}

/**
 * The lock on a file — `identifier.open`. "Open" means open for editing by
 * somebody, so it reads as taken, not available.
 *
 * Only a free file may be picked up. A capture lock is released by the
 * assignment's own workflow and by nothing else; a sequencing lock by
 * whoever took it, or by an administrator.
 */
export const IdentifierLock = {
  FREE: 0,
  CAPTURE: 1,
  SEQUENCING: 2,
} as const;

export interface ProjectDetails {
  project_id: number;
  project_name: string;
  customer_id: number;
  identifier_label: string;
  is_active: 0 | 1;
}

export const documentService = {
  async getProjectById(projectId: number, accessToken: string): Promise<ProjectDetails | null> {
    const response = await fetch(`${API_URL}/project/${projectId}`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error("Failed to fetch project");
    }

    const body = await response.json();
    return body.data || null;
  },

  // Fetch a single identifier by its own ID, straight from the identifier
  // table — used when the identifier in question isn't guaranteed to be in
  // an already-fetched, project-scoped identifiers list (e.g. an assignment
  // may reference an identifier outside the currently selected project).
  /** Take this file for sequencing. 409 if anything else holds it. */
  async openForSequencing(identifierId: number, accessToken: string): Promise<Identifier> {
    const response = await fetch(`${API_URL}/identifier/${identifierId}/open-sequencing`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });
    if (!response.ok) {
      throw new Error(await extractMessage(response, "Could not open this file for sequencing"));
    }
    const body = await response.json();
    return body.data;
  },

  /** Release it — the holder, or an administrator clearing a stuck one. */
  async closeSequencing(identifierId: number, accessToken: string): Promise<Identifier> {
    const response = await fetch(`${API_URL}/identifier/${identifierId}/close-sequencing`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });
    if (!response.ok) {
      throw new Error(await extractMessage(response, "Could not close this file"));
    }
    const body = await response.json();
    return body.data;
  },

  async getIdentifierById(identifierId: number, accessToken: string): Promise<Identifier | null> {
    const response = await fetch(`${API_URL}/identifier/${identifierId}`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error("Failed to fetch identifier");
    }

    const body = await response.json();
    return body.data || null;
  },

  /**
   * Every page of a file, for the administration screens: unverified work and
   * retired pages included, in file order.
   *
   * The public read (`getImageCountByIdentifier` above uses it) shows only
   * finished work. Arranging a file has to see all of it.
   */
  async getFilePages(
    projectId: number,
    identifierValue: string,
    accessToken: string,
  ): Promise<FilePage[]> {
    const response = await fetch(
      `${API_URL}/image/project/${projectId}/identifier/${encodeURIComponent(
        identifierValue,
      )}/all`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      },
    );

    if (!response.ok) {
      throw new Error(await extractMessage(response, "Failed to read the file"));
    }

    const body = await response.json();
    return body.data || [];
  },

  /**
   * Put a whole file in order: the complete list of its pages, in the order
   * they should be. The server refuses unless the caller is an administrator
   * on the project and the file has no assignment open on it.
   */
  async arrangeFile(
    identifierId: number,
    imageIds: number[],
    accessToken: string,
    notes?: string,
  ): Promise<{ pages: number; moved: number }> {
    const response = await fetch(`${API_URL}/image/file-order`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ identifier_id: identifierId, image_ids: imageIds, notes }),
    });

    if (!response.ok) {
      throw new Error(await extractMessage(response, "Failed to save the order"));
    }

    const body = await response.json();
    return body.data;
  },

  /** Every time this file was put in order, newest first. */
  async getArrangeHistory(
    identifierId: number,
    accessToken: string,
  ): Promise<ArrangeRecord[]> {
    const response = await fetch(
      `${API_URL}/image/identifier/${identifierId}/arrange-history`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      },
    );

    if (!response.ok) return [];
    const body = await response.json();
    return body.data || [];
  },

  // Count the images already stored against an identifier. The API's
  // pull-by-identifier route keys off identifier_value + project_id (not
  // identifier_id), so callers pass the identifier record's own project_id —
  // an assignment's identifier isn't guaranteed to sit in the currently
  // selected project. Returns the row count only; the image rows themselves
  // come back with their category/attribute includes and aren't needed here.
  async getImageCountByIdentifier(
    projectId: number,
    identifierValue: string,
    accessToken: string
  ): Promise<number> {
    const response = await fetch(
      `${API_URL}/image/project/${projectId}/identifier/${encodeURIComponent(identifierValue)}`,
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      throw new Error(await extractMessage(response, "Failed to fetch images for identifier"));
    }

    const body = await response.json();
    return Array.isArray(body.data) ? body.data.length : 0;
  },

  async getIdentifiers(projectId: number, accessToken: string): Promise<IdentifiersResponse> {
    const response = await fetch(
      `${API_URL}/identifier/project/${projectId}`,
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      throw new Error("Failed to fetch identifiers");
    }

    return response.json();
  },

  async getAttributes(projectId: number, accessToken: string): Promise<AttributesResponse> {
    const response = await fetch(
      `${API_URL}/attribute/project/${projectId}`,
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      throw new Error("Failed to fetch attributes");
    }

    return response.json();
  },

  // Project-scoped on purpose — GET /category/ returns every customer's
  // categories (see the tenancy notes in smartdoc_context/domain-model.md).
  async getCategories(projectId: number, accessToken: string): Promise<CategoriesResponse> {
    const response = await fetch(`${API_URL}/category/project/${projectId}`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(await extractMessage(response, "Failed to fetch categories"));
    }

    return response.json();
  },

  /**
   * Put a category on one document, by hand.
   *
   * Two calls, the same pair the analyze service makes when it categorises a
   * document itself:
   *
   * 1. `image_category` — updated in place when the document already has a
   *    category, because the API reads it back with an unordered `findOne`;
   *    a second row would make which category wins a coin toss.
   * 2. `image_status` — a new row saying the document has been categorised,
   *    which is where the "Categorised" chip gets its answer from.
   *
   * `is_processed` is 0 here on purpose: this says nothing about whether the
   * document was enhanced, and the flags are ORed across rows, so a 0 cannot
   * unsay an earlier 1.
   */
  async setImageCategory(
    imageId: number,
    categoryId: number,
    imageCategoryId: number | null,
    accessToken: string,
  ): Promise<void> {
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    };

    const assignment = await fetch(`${API_URL}/image_category/`, {
      method: imageCategoryId ? "PUT" : "POST",
      headers,
      body: JSON.stringify(
        imageCategoryId
          ? { image_category_id: imageCategoryId, image_id: imageId, category_id: categoryId }
          : { image_id: imageId, category_id: categoryId },
      ),
    });

    if (!assignment.ok) {
      throw new Error(await extractMessage(assignment, "Failed to set the category"));
    }

    // image_status 3 = CLASSIFIED, matching smartdoc_analyze_service.
    const status = await fetch(`${API_URL}/image_status/`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        image_id: imageId,
        image_status: 3,
        is_processed: 0,
        is_verified: 0,
        is_analyzed: 1,
      }),
    });

    if (!status.ok) {
      throw new Error(await extractMessage(status, "Category saved, but its status was not recorded"));
    }
  },

  /**
   * Say a document has been worked on by hand.
   *
   * image_status 2 = PROCESSED, the same row `smartdoc_enhance_service`
   * writes when it enhances one — which is what makes the "Enhanced" chip
   * turn green. `is_analyzed` is 0 here: editing the picture says nothing
   * about categorisation, and the flags are ORed across rows so a 0 cannot
   * unsay an earlier 1.
   */
  async markImageProcessed(imageId: number, accessToken: string): Promise<void> {
    const response = await fetch(`${API_URL}/image_status/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        image_id: imageId,
        image_status: 2,
        is_processed: 1,
        is_verified: 0,
        is_analyzed: 0,
      }),
    });

    if (!response.ok) {
      throw new Error(
        await extractMessage(response, "The edit was stored, but its status was not recorded"),
      );
    }
  },

  // `is_active` is NOT NULL with no DB-level default and the API passes it
  // straight through, so it has to be sent explicitly on create.
  async createCategory(
    input: Omit<Category, "category_id">,
    accessToken: string
  ): Promise<Category> {
    const response = await fetch(`${API_URL}/category/`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      throw new Error(await extractMessage(response, "Failed to create category"));
    }

    const body = await response.json();
    return body.data;
  },

  // PUT /category/ replaces every column at once (not a partial patch) —
  // callers must pass the full current record, not just the field being
  // changed, or the others get overwritten with undefined.
  async updateCategory(input: Category, accessToken: string): Promise<Category> {
    const response = await fetch(`${API_URL}/category/`, {
      method: "PUT",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      throw new Error(await extractMessage(response, "Failed to update category"));
    }

    const body = await response.json();
    return body.data?.data;
  },

  async createAttribute(
    input: Omit<Attribute, "attribute_id">,
    accessToken: string
  ): Promise<Attribute> {
    const response = await fetch(`${API_URL}/attribute/`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      throw new Error(await extractMessage(response, "Failed to create attribute"));
    }

    const body = await response.json();
    return body.data;
  },

  // PUT /attribute/ replaces every column at once (not a partial patch) —
  // callers must pass the full current record, not just the field being
  // changed, or the others get overwritten with undefined.
  async updateAttribute(input: Attribute, accessToken: string): Promise<Attribute> {
    const response = await fetch(`${API_URL}/attribute/`, {
      method: "PUT",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      throw new Error(await extractMessage(response, "Failed to update attribute"));
    }

    const body = await response.json();
    return body.data?.data;
  },

  async createIdentifier(
    identifierValue: string,
    projectId: number,
    accessToken: string
  ): Promise<Identifier> {
    const response = await fetch(`${API_URL}/identifier/`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        identifier_value: identifierValue,
        project_id: projectId,
      }),
    });

    if (!response.ok) {
      throw new Error(await extractMessage(response, "Failed to create identifier"));
    }

    const body = await response.json();
    return body.data;
  },

  // PUT /identifier/ replaces identifier_value/project_id/open together (not
  // a partial patch) — callers must pass the full current record, not just
  // the field being changed, or the others get overwritten with undefined.
  // `open` is the upload/verification gate, not a soft-delete flag: an
  // identifier stays open while images are still being uploaded to it, and
  // only becomes assignable for verification once closed (open === 0) —
  // see the assignable filter in pages/Assignments.tsx.
  async updateIdentifier(
    identifierId: number,
    identifierValue: string,
    projectId: number,
    // Passed through unchanged: renaming a file must not disturb its lock.
    open: 0 | 1 | 2,
    accessToken: string
  ): Promise<Identifier> {
    const response = await fetch(`${API_URL}/identifier/`, {
      method: "PUT",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        identifier_id: identifierId,
        identifier_value: identifierValue,
        project_id: projectId,
        open,
      }),
    });

    if (!response.ok) {
      throw new Error(await extractMessage(response, "Failed to update identifier"));
    }

    const body = await response.json();
    return body.data?.data;
  },
};
