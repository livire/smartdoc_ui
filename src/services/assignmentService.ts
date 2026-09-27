const API_URL = import.meta.env.VITE_API_URL;

export interface Assignment {
  assignment_id: number;
  assigned_by: number | null;
  assignment_date: string;
  identifier_id: number;
  assignment_notes: string | null;
  // Whoever holds this batch has said they cannot finish it.
  handover_requested?: 0 | 1;
  // What people call this batch: YYMMDDHHMMSS, from when it was created.
  assignment_code?: string | null;
  // Who currently holds the job. `assigned_to` on the assignment named only
  // the original capturer and is being dropped; the open stage is the real
  // answer, and it follows a send-back to whoever picks the work up next.
  assignment_stages?: {
    assignment_stage_id: number;
    stage_type: number;
    round: number;
    assigned_to: number | null;
    stage_status: number;
    started_at?: string | null;
    completed_at?: string | null;
    // The reason for whatever last happened on this stage — a send-back,
    // a decline, a handover request, a cancellation.
    notes?: string | null;
  }[];
  // See AssignmentStatus in assignmentStageService.ts. Widened from 1|2|3
  // when the ladder grew to seven states; kept as `number` because the
  // server owns this value and the client only ever displays it.
  assignment_status: number;
}

/**
 * The batch's name, for reading: `260914-020901`.
 *
 * The primary key is a number that means nothing outside the database — one
 * project's batch 41 and another's are both "41". The code carries the day
 * and time it was created and is unique across the system. Rows made before
 * the code existed fall back to `#id`, which is still better than nothing.
 */
export const assignmentLabel = (a: {
  assignment_code?: string | null;
  assignment_id: number;
}): string =>
  a.assignment_code && a.assignment_code.length === 12
    ? `${a.assignment_code.slice(0, 6)}-${a.assignment_code.slice(6)}`
    : `#${a.assignment_id}`;

// The user currently responsible for an assignment: the assignee of its open
// stage (highest round). Null when nothing is open — e.g. a verified batch,
// or a verify stage sitting unclaimed in the shared queue.
export const currentHolder = (a: Assignment): number | null => {
  const open = (a.assignment_stages || [])
    .filter((s) => s.stage_status === 1 || s.stage_status === 2)
    .sort((x, y) => y.round - x.round)[0];
  return open ? open.assigned_to : null;
};

export interface NewAssignmentInput {
  identifier_id: number;
  assigned_to: number;
  assigned_by: number;
  assignment_notes?: string;
}

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

export const assignmentService = {
  // Project-scoped. Replaced an unscoped getAll() that returned every
  // assignment system-wide and left callers to filter client-side — which
  // meant one company's assignment rows reached another company's browser.
  // Do not reintroduce a caller of GET /assignment/.
  async getByProject(projectId: number, accessToken: string): Promise<Assignment[]> {
    const response = await fetch(`${API_URL}/assignment/project/${projectId}`, {
      method: "GET",
      headers: jsonHeaders(accessToken),
    });

    if (!response.ok) {
      throw new Error(await extractMessage(response, "Failed to fetch assignments"));
    }

    const body = await response.json();
    return body.data || [];
  },

  async create(input: NewAssignmentInput, accessToken: string): Promise<Assignment> {
    const response = await fetch(`${API_URL}/assignment/`, {
      method: "POST",
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({
        identifier_id: input.identifier_id,
        assigned_to: input.assigned_to,
        assigned_by: input.assigned_by,
        assignment_notes: input.assignment_notes || null,
        assignment_status: 1,
        assignment_date: new Date().toISOString(),
      }),
    });

    if (!response.ok) {
      throw new Error(await extractMessage(response, "Failed to create assignment"));
    }

    const body = await response.json();
    return body.data;
  },

  // updateStatus() was removed 2026-08-05. assignment_status is now owned
  // by the server and moves together with the stage rows in one transaction
  // — see assignmentStageService.transition(). Do not add a client-side
  // writer back; PUT /assignment/ replaces the whole row and would let a
  // screen invent a status the state machine never agreed to.
};
