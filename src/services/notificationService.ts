import { authService } from "./authService";

const API_URL = import.meta.env.VITE_API_URL;

/** One thing that happened, told to this person. */
export interface NotificationEvent {
  notification_event_id: number;
  area: string;
  event: string;
  subject_type: string | null;
  subject_id: number | null;
  project_id: number | null;
  // What the line needs to render, copied when it was written — the reason a
  // batch came back, how many pages it held. A notification says what was
  // true at the time, so this is not refreshed against the live row.
  detail: Record<string, unknown> | null;
  created_at: string;
  read_at: string | null;
}

/** Something that is wrong now, rather than something that happened. */
export interface NotificationCondition {
  notification_condition_id: number;
  audience: string;
  scope_id: number;
  area: string;
  condition: string;
  subject_type: string | null;
  subject_id: number;
  detail: Record<string, unknown> | null;
  first_seen_at: string;
  last_seen_at: string;
  // Somebody has seen it. Not "read" — it is still true, and stays listed.
  // What stops is the counting.
  acknowledged_at: string | null;
}

export interface NotificationPage {
  rows: NotificationEvent[];
  total: number;
  page: number;
  size: number;
}

const headers = (token: string) => ({
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
});

/** One area as it resolves for a project, or for the customer itself. */
export interface NotificationArea {
  label: string;
  // Which app it belongs to. The two have different audiences.
  surface: "work" | "viewer";
  kind: "event" | "condition";
  audience: string;
  switchable: boolean;
  on_by_default: boolean;
  enabled: boolean;
  // Where the answer came from, so the screen can say "following the
  // customer" rather than pretending the project decided it.
  decided_by: "project" | "customer" | "default";
  threshold_days: number | null;
  // What the customer permits, as opposed to what this person will get.
  // Only differs on `/areas/mine`.
  allowed?: boolean;
  refused_by_me?: boolean;
}

export type NotificationAreas = Record<string, NotificationArea>;

export const notificationService = {
  /**
   * The bell's number.
   *
   * Its own call rather than counting a page of rows: the header asks on
   * every screen, and twenty rows to produce one integer is twenty rows of
   * JSON nobody reads.
   */
  async unreadCount(): Promise<number> {
    const token = await authService.ensureValidToken();
    // This app's own areas only, so a reader's notifications do not land
    // in the staff bell.
    const response = await fetch(`${API_URL}/notification/count?surface=work`, {
      headers: headers(token),
    });
    if (!response.ok) return 0; // A bell that cannot count is not worth an error on screen.
    const body = await response.json();
    return Number(body?.data?.unread ?? 0);
  },

  /**
   * What is wrong now, for whoever is asking.
   *
   * Not read/unread — a condition is not a message. It is here while it is
   * true and gone when somebody fixes it, so there is nothing to mark.
   */
  async conditions(): Promise<NotificationCondition[]> {
    const token = await authService.ensureValidToken();
    const response = await fetch(`${API_URL}/notification/conditions`, { headers: headers(token) });
    if (!response.ok) return [];
    const body = await response.json();
    return (body?.data?.rows ?? []) as NotificationCondition[];
  },

  /**
   * Seen it, dealing with it.
   *
   * Stops the counting; the condition stays in the list until it is really
   * fixed, at which point the sweep removes it.
   */
  async acknowledgeCondition(id: number): Promise<void> {
    const token = await authService.ensureValidToken();
    const response = await fetch(`${API_URL}/notification/conditions/acknowledge`, {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({ notification_condition_id: id }),
    });
    if (!response.ok) throw new Error("Could not acknowledge");
  },

  /** A page of them, newest first. */
  async list(options: { area?: string; unreadOnly?: boolean; page?: number; size?: number } = {}): Promise<NotificationPage> {
    const token = await authService.ensureValidToken();
    const query = new URLSearchParams();
    query.set("surface", "work");
    if (options.area) query.set("area", options.area);
    if (options.unreadOnly) query.set("unread", "1");
    query.set("page", String(options.page ?? 1));
    query.set("size", String(options.size ?? 20));

    const response = await fetch(`${API_URL}/notification/?${query}`, { headers: headers(token) });
    if (!response.ok) throw new Error("Could not load notifications");
    const body = await response.json();
    return body.data as NotificationPage;
  },

  /** Which areas are on, for a project or for the customer itself. */
  async areas(projectId?: number | null, surface?: "work" | "viewer"): Promise<NotificationAreas> {
    const token = await authService.ensureValidToken();
    const params = new URLSearchParams();
    if (projectId) params.set("project_id", String(projectId));
    if (surface) params.set("surface", surface);
    const query = params.toString() ? `?${params}` : "";
    const response = await fetch(`${API_URL}/notification/areas${query}`, { headers: headers(token) });
    if (!response.ok) throw new Error("Could not load notification settings");
    const body = await response.json();
    return body.data as NotificationAreas;
  },

  /** Switch one on or off. Answers the areas as they now resolve. */
  async setArea(input: {
    area: string;
    enabled: boolean;
    projectId?: number | null;
    thresholdDays?: number | null;
  }): Promise<NotificationAreas> {
    const token = await authService.ensureValidToken();
    const response = await fetch(`${API_URL}/notification/areas`, {
      method: "PUT",
      headers: headers(token),
      body: JSON.stringify({
        area: input.area,
        enabled: input.enabled,
        project_id: input.projectId ?? 0,
        threshold_days: input.thresholdDays ?? null,
      }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.message || "Could not save");
    }
    const body = await response.json();
    return body.data as NotificationAreas;
  },

  /** Let a project follow its customer again. */
  async clearArea(area: string, projectId: number): Promise<NotificationAreas> {
    const token = await authService.ensureValidToken();
    const response = await fetch(`${API_URL}/notification/areas/clear`, {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({ area, project_id: projectId }),
    });
    if (!response.ok) throw new Error("Could not reset");
    const body = await response.json();
    return body.data as NotificationAreas;
  },

  /** Mark some read, or all of them when nothing is passed. */
  async markRead(ids?: number[]): Promise<number> {
    const token = await authService.ensureValidToken();
    const response = await fetch(`${API_URL}/notification/read`, {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify(ids && ids.length ? { notification_event_ids: ids } : {}),
    });
    if (!response.ok) throw new Error("Could not mark as read");
    const body = await response.json();
    return Number(body?.data?.marked ?? 0);
  },
};

/**
 * One line of text for a notification.
 *
 * Built here rather than stored, so wording can be changed without a
 * migration and without rewriting rows that already exist. The `detail`
 * copied at the time is what fills it in.
 */
export function describe(n: NotificationEvent): { title: string; body: string | null } {
  const detail = (n.detail ?? {}) as Record<string, unknown>;

  switch (n.event) {
    case "batch_assigned":
      return {
        title: detail.handed_over ? "A batch was moved to you" : "You were given a batch",
        body: (detail.note as string) || null,
      };
    case "batch_returned":
      return {
        title: "Your batch was sent back",
        // The reason is the whole point. Without it somebody opens the
        // screen to learn the one thing the message should have said.
        body: (detail.reason as string) || null,
      };
    case "batch_verified":
      return {
        title: "Your batch was checked and finished",
        body: detail.pages ? `${detail.pages} pages` : null,
      };
    case "identifier_received":
      return { title: "A file arrived from another system", body: (detail.label as string) || null };
    case "identifier_refused":
      return { title: "A file from another system was refused", body: (detail.reason as string) || null };
    default:
      // An event this front end has not been taught about. Showing the raw
      // name is poor, but silence would hide a real notification.
      return { title: n.event.replace(/_/g, " "), body: null };
  }
}

/**
 * Where clicking it should go, or null when there is nowhere useful.
 *
 * **A notification belongs to a project, and the screens do too.** The
 * person reading it may have no project open — the header is drawn on the
 * project chooser as well — or have a different one open. Sending them to a
 * project screen then shows somebody else's work or an empty page, so both
 * cases go to the chooser instead.
 *
 * **Never Digitize.** That screen opens the *oldest* batch waiting to be
 * started, not the one named here, so a notification about one batch would
 * open another. My Assignments lists them and lets somebody pick the one
 * they were told about.
 */
export function linkFor(
  n: NotificationEvent,
  customerUrl: string,
  currentProjectId: number | null
): string | null {
  if (n.project_id && Number(n.project_id) !== Number(currentProjectId)) {
    return `/${customerUrl}/select-project`;
  }
  if (!currentProjectId) return `/${customerUrl}/select-project`;

  if (n.subject_type === "assignment") return `/${customerUrl}/my-assignments`;
  if (n.subject_type === "identifier") return `/${customerUrl}/identifiers`;
  return null;
}

/** One line of text for a condition. */
export function describeCondition(c: NotificationCondition): { title: string; body: string | null } {
  const d = (c.detail ?? {}) as Record<string, unknown>;

  switch (c.condition) {
    case "batch_waiting":
      return {
        title: `${d.assignment_code || "A batch"} is waiting to be checked`,
        body: `${d.days_waiting} days so far`,
      };
    case "pipeline_failed":
      return {
        title: `${d.assignment_code || "A batch"} has pages the pipeline gave up on`,
        // The count, not a line per page: one bad scanner is one problem.
        body: `${d.failed} ${Number(d.failed) === 1 ? "page" : "pages"}`,
      };
    case "key_expiring":
      return {
        title: `API key "${d.key_label}" expires soon`,
        body: `${d.days_left} days left`,
      };
    default:
      return { title: c.condition.replace(/_/g, " "), body: null };
  }
}
