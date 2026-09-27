const API_URL = import.meta.env.VITE_API_URL;

// Mirrors smartdoc_api/enums.js. A stage is one hand-off of an assignment to
// one person; the assignment's own status is a separate ladder.
export const StageType = {
  CAPTURE: 1,
  VERIFY: 2,
} as const;

export const StageStatus = {
  PENDING: 1,
  IN_PROGRESS: 2,
  COMPLETED: 3,
  RETURNED: 4,
} as const;

export const AssignmentStatus = {
  PENDING_CAPTURE: 1,
  CAPTURING: 2,
  PENDING_VERIFICATION: 3,
  VERIFYING: 4,
  RETURNED_FOR_CORRECTION: 5,
  VERIFIED: 6,
  CANCELLED: 7,
} as const;

export type AssignmentStatusValue =
  (typeof AssignmentStatus)[keyof typeof AssignmentStatus];

export const ASSIGNMENT_STATUS_LABELS: Record<number, string> = {
  1: "Pending",
  2: "Capturing",
  3: "Awaiting verification",
  4: "Being verified",
  5: "Returned",
  6: "Verified",
  7: "Cancelled",
};

export const ASSIGNMENT_STATUS_COLORS: Record<
  number,
  "warning" | "info" | "success" | "error" | "light"
> = {
  1: "warning",
  2: "info",
  3: "warning",
  4: "info",
  5: "error",
  6: "success",
  7: "light",
};

export interface AssignmentStage {
  assignment_stage_id: number;
  assignment_id: number;
  stage_type: number;
  round: number;
  assigned_to: number | null;
  stage_status: number;
  started_at: string | null;
  completed_at: string | null;
  notes: string | null;
  // Present on verifier-queue rows, which join out to the assignment.
  assignment?: {
    assignment_id: number;
    identifier_id: number;
    assignment_status: number;
    assignment_code?: string | null;
    assignment_notes: string | null;
  };
}

// Lifecycle events accepted by POST /assignment_stage/transition.
export type TransitionEvent =
  | "START_CAPTURE"
  | "CLOSE_CAPTURE"
  | "CLAIM_VERIFY"
  | "RELEASE_VERIFY"
  | "COMPLETE_VERIFY"
  | "RETURN"
  | "CANCEL"
  // Giving back a batch with nothing in it.
  | "DECLINE_CAPTURE"
  // A supervisor moving a batch to someone else. Takes assignedTo.
  | "HAND_OVER";

export interface TransitionResult {
  assignment_id: number;
  assignment_status: number;
  stages: AssignmentStage[];
}

const jsonHeaders = (accessToken: string) => ({
  Authorization: `Bearer ${accessToken}`,
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

// An assignment the caller holds a stage on. `my_stage` is the stage that
// makes it theirs — the latest round they hold, so after a send-back it's the
// new capture stage rather than the original one.
//
// getMyWork returns only OPEN stages (pending or in progress), so a batch
// stops being "mine" the moment I close it. getMyRecentWork returns the
// finished ones, and there `my_stage` is the completed stage itself.
export interface MyAssignment {
  assignment_id: number;
  identifier_id: number;
  assignment_status: number;
  assignment_notes: string | null;
  assignment_date: string;
  assigned_by: number | null;
  // Set when whoever holds this batch has said they cannot finish it.
  handover_requested?: 0 | 1;
  // What people call this batch — see assignmentLabel().
  assignment_code?: string | null;
  my_stage: AssignmentStage;
  // Who captured the batch. Only filled in for a verify stage — on a capture
  // stage the answer is the person reading the screen.
  captured_by?: number | null;
  captured_by_username?: string | null;
  // Why the batch was last sent back, and by whom. Set on a corrections round
  // so the person redoing the work can see what was wrong with it.
  return_reason?: string | null;
  returned_by?: number | null;
  returned_by_username?: string | null;
}

// A row in the verifier queue: the stage, plus what the screen needs to
// decide what to show — and whether this person is allowed to claim it.
//
// `can_claim` is false, with a reason, rather than the row being hidden. A
// batch you captured on a project with self-verification off still appears,
// greyed out and explained; silently omitting it leaves a verifier wondering
// where the work went.
export interface VerifyQueueItem extends AssignmentStage {
  identifier_value: string | null;
  document_count: number;
  captured_by: number | null;
  captured_by_username: string | null;
  previous_return_reason: string | null;
  can_claim: boolean;
  claim_blocked_reason: string | null;
}

export const assignmentStageService = {
  // Replaces filtering the project's assignments by `assigned_to` — ownership
  // is a property of the current hand-off, not of the job. The server reads
  // identity from the token, so there is no user id to pass or get wrong.
  async getMyWork(projectId: number, accessToken: string): Promise<MyAssignment[]> {
    const response = await fetch(`${API_URL}/assignment_stage/mine/project/${projectId}`, {
      method: "GET",
      headers: jsonHeaders(accessToken),
    });

    if (!response.ok) {
      throw new Error(await extractMessage(response, "Failed to fetch your assignments"));
    }

    const body = await response.json();
    return body.data || [];
  },

  // Finished stages, newest first. Separate from getMyWork on purpose: that
  // one answers "what do I have to do", this one answers "did the batch I
  // closed actually go through" (verification-redesign.md §12.4b).
  async getMyRecentWork(
    projectId: number,
    days: number,
    accessToken: string
  ): Promise<MyAssignment[]> {
    const response = await fetch(
      `${API_URL}/assignment_stage/mine/recent/project/${projectId}?days=${days}`,
      { method: "GET", headers: jsonHeaders(accessToken) }
    );

    if (!response.ok) {
      throw new Error(await extractMessage(response, "Failed to fetch your recent work"));
    }

    const body = await response.json();
    return body.data || [];
  },

  async getByAssignment(assignmentId: number, accessToken: string): Promise<AssignmentStage[]> {
    const response = await fetch(`${API_URL}/assignment_stage/assignment/${assignmentId}`, {
      method: "GET",
      headers: jsonHeaders(accessToken),
    });

    if (!response.ok) {
      throw new Error(await extractMessage(response, "Failed to fetch assignment stages"));
    }

    const body = await response.json();
    return body.data || [];
  },

  // The caller's own queue — the server reads identity from the token, so
  // there is no user parameter to get wrong.
  async getVerifyQueue(projectId: number, accessToken: string): Promise<VerifyQueueItem[]> {
    const response = await fetch(`${API_URL}/assignment_stage/queue/project/${projectId}`, {
      method: "GET",
      headers: jsonHeaders(accessToken),
    });

    if (!response.ok) {
      throw new Error(await extractMessage(response, "Failed to fetch the verification queue"));
    }

    const body = await response.json();
    return body.data || [];
  },

  // The only way to move an assignment. Never write assignment_status from
  // the client — the server owns it, and it moves with the stage rows in one
  // transaction.
  async transition(
    assignmentId: number,
    event: TransitionEvent,
    accessToken: string,
    notes?: string,
    // HAND_OVER only: who is taking the batch over.
    assignedTo?: number
  ): Promise<TransitionResult> {
    const response = await fetch(`${API_URL}/assignment_stage/transition`, {
      method: "POST",
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({
        assignment_id: assignmentId,
        event,
        notes,
        assigned_to: assignedTo,
      }),
    });

    if (!response.ok) {
      // The server explains refusals in plain language — an illegal move, a
      // lost claim race, a stage that isn't yours — so surface it as-is.
      throw new Error(await extractMessage(response, "Failed to update the assignment"));
    }

    const body = await response.json();
    return body.data;
  },

  /**
   * "I cannot finish this batch."
   *
   * Not a transition — nothing about the job's state changes. It marks the
   * assignment so a supervisor sees it and decides who takes it on. Only for
   * a batch that already holds documents; an empty one is simply declined.
   */
  async requestHandover(
    assignmentId: number,
    notes: string,
    accessToken: string
  ): Promise<void> {
    const response = await fetch(`${API_URL}/assignment_stage/handover-request`, {
      method: "POST",
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ assignment_id: assignmentId, notes }),
    });

    if (!response.ok) {
      throw new Error(await extractMessage(response, "Failed to ask for a handover"));
    }
  },
};
