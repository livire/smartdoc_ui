const API_URL = import.meta.env.VITE_API_URL;

const jsonHeaders = (accessToken: string) => ({
  "Authorization": `Bearer ${accessToken}`,
  "Content-Type": "application/json",
});

const extractMessage = async (response: Response, fallback: string) => {
  try {
    const body = await response.json();
    return body?.message || fallback;
  } catch {
    return fallback;
  }
};

// image_status values that mean a verifier has ruled on the document.
export const ImageDecision = {
  VERIFIED: 5,
  REJECTED: 6,
} as const;

export interface ReviewComment {
  assignment_comment_id: number;
  assignment_id: number;
  image_id: number | null;
  assignment_stage_id: number;
  comment: string;
  // The author's id. The column is `user_id`; `created_by` never existed,
  // which is why notes used to show as "Unknown".
  user_id: number;
  // Resolved server-side — an id tells the reader nothing.
  created_by_username?: string | null;
  created_at: string;
}

export interface ReviewStage {
  assignment_stage_id: number;
  stage_type: number;
  round: number;
  stage_status: number;
  assigned_to: number | null;
  assigned_to_username?: string | null;
  started_at: string | null;
  completed_at: string | null;
  notes: string | null;
}

export interface ReviewImage {
  image: {
    image_id: number;
    identifier_id: number;
    image_path: string;
    assignment_id: number | null;
    // Set when this page was shot to replace one a verifier sent back.
    replaces_image_id?: number | null;
    // Where the page sits in the FILE — spaced (1000, 2000, 3000), so it is
    // never shown as-is. Screens count the list instead: "3 of 29".
    seq_no?: number | null;
  };
  current_status: number | null;
  // Three independent answers, from image_status's boolean columns. The status
  // VALUE is a ladder and can't say "categorised but never enhanced", which is
  // a real state when a project has auto_process off.
  enhanced?: boolean;
  categorised?: boolean;
  // Whether the page has been read. From image_text, not from a status —
  // there is no "OCR succeeded" status, the row is the record. A blank page
  // has a row too, holding an empty string, so it reads as done.
  read?: boolean;
  verified?: boolean;
  // Still with enhance or analyze, by this project's rules — decided by the
  // API, which is also what refuses to close the assignment.
  pipeline_pending?: boolean;
  // A stage that tried and gave up. Different from "not enhanced", which may
  // simply be a project with that stage switched off.
  enhance_failed?: boolean;
  analyze_failed?: boolean;
  ocr_failed?: boolean;
  // null until someone rules on it — that's what "undecided" means.
  decision: number | null;
  decided_in_stage_id: number | null;
  comments: ReviewComment[];
}

export interface Review {
  assignment: {
    assignment_id: number;
    identifier_id: number;
    assignment_status: number;
    assignment_notes: string | null;
    // What people call this batch — see assignmentLabel().
    assignment_code?: string | null;
  };
  active_verify_stage_id: number | null;
  stages: ReviewStage[];
  batch_comments: ReviewComment[];
  images: ReviewImage[];
  // Pages sent back and since replaced. Not part of the batch any more, but
  // kept so a corrections round leaves a trace.
  retired_images: {
    image: { image_id: number; image_path: string };
    decision: number | null;
    comments: ReviewComment[];
  }[];
  summary: {
    total: number;
    undecided: number;
    rejected: number;
    // All decided and none rejected — the only way to Complete (§12.2).
    can_complete: boolean;
    must_return: boolean;
  };
}

export const verificationService = {
  async getReview(assignmentId: number, accessToken: string): Promise<Review> {
    const response = await fetch(`${API_URL}/verification/review/${assignmentId}`, {
      method: "GET",
      headers: jsonHeaders(accessToken),
    });

    if (!response.ok) {
      throw new Error(await extractMessage(response, "Failed to load the batch"));
    }

    const body = await response.json();
    return body.data;
  },

  // Accept or reject one document. Returns the whole review again, so the
  // summary and the Complete/Return buttons stay in step with the server
  // rather than being recomputed here.
  async decideImage(
    assignmentId: number,
    imageId: number,
    accept: boolean,
    accessToken: string,
    comment?: string,
    categoryId?: number
  ): Promise<Review> {
    const response = await fetch(`${API_URL}/verification/decide`, {
      method: "POST",
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({
        assignment_id: assignmentId,
        image_id: imageId,
        accept,
        // The server refuses a rejection with no reason — the uploader would
        // be told to redo a page without knowing what was wrong with it.
        comment,
        category_id: categoryId,
      }),
    });

    if (!response.ok) {
      throw new Error(await extractMessage(response, "Failed to record the decision"));
    }

    const body = await response.json();
    return body.data;
  },

  /**
   * Accept or reject many documents in one request.
   *
   * One request, one transaction, one review built at the end. Sending them
   * one at a time meant the server rebuilt the entire review per page — on
   * a 194-page batch, about eleven minutes of it.
   */
  async decideImages(
    assignmentId: number,
    decisions: {
      image_id: number;
      accept: boolean;
      comment?: string;
      category_id?: number;
    }[],
    accessToken: string
  ): Promise<Review> {
    const response = await fetch(`${API_URL}/verification/decide-many`, {
      method: "POST",
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ assignment_id: assignmentId, decisions }),
    });

    if (!response.ok) {
      throw new Error(await extractMessage(response, "Failed to record the decisions"));
    }

    const body = await response.json();
    return body.data;
  },

  // Omit imageId for a comment about the whole batch.
  /**
   * Retire a rejected document that has been re-shot. The replacement is
   * uploaded first; this drops the old one out of the batch.
   */
  async supersedeImage(
    assignmentId: number,
    imageId: number,
    replacementImageId: number,
    accessToken: string,
  ): Promise<Review> {
    const response = await fetch(`${API_URL}/verification/supersede`, {
      method: "POST",
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({
        assignment_id: assignmentId,
        image_id: imageId,
        replacement_image_id: replacementImageId,
      }),
    });

    if (!response.ok) {
      throw new Error(await extractMessage(response, "Failed to replace the document"));
    }

    const body = await response.json();
    return body.data;
  },

  async addComment(
    assignmentId: number,
    text: string,
    accessToken: string,
    imageId?: number
  ): Promise<ReviewComment> {
    const response = await fetch(`${API_URL}/verification/comment`, {
      method: "POST",
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({
        assignment_id: assignmentId,
        image_id: imageId,
        comment: text,
      }),
    });

    if (!response.ok) {
      throw new Error(await extractMessage(response, "Failed to add the comment"));
    }

    const body = await response.json();
    return body.data;
  },
};
