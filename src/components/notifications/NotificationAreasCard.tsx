import { useCallback, useEffect, useState } from "react";
import {
  notificationService,
  NotificationAreas,
} from "../../services/notificationService";
import Toast from "../common/Toast";

/**
 * Which kinds of notification this customer wants, and which one project
 * wants differently.
 *
 * **Seven switches, not thirty.** An area is the unit somebody can reason
 * about — "pipeline faults" — where a switch per event would be a screen
 * nobody touches.
 *
 * Two areas are shown but cannot be switched: *System* is not a customer's
 * business, and *Access and keys* stays on because switching off the warning
 * that storage credentials are dead is switching off the thing that explains
 * why uploads stopped. Shown rather than hidden, so the answer for every
 * area is in one place.
 */
// What sets each one off. Kept here so the wording can change without a
// database migration.
const DESCRIPTIONS: Record<string, string> = {
  my_work: "A batch is given to you, sent back, or verified",
  batch_progress: "A batch has waited too many days to be verified",
  pipeline_faults: "A page failed enhancement, OCR or categorisation",
  identifiers: "A file arrives from another system, or is refused",
  access_and_keys: "An API key or a storage password is about to expire",
  system: "A model key stops working, or the Vault token is expiring",
  sent_to_me: "A colleague sends you a document",
  forward_replies: "Someone answers a conversation you are in",
  page_comments: "Someone comments on a page you were sent",
  page_marks: "Someone marks a page you were sent",
};

export default function NotificationAreasCard({
  projectId = null,
  surface,
}: {
  // Null edits the customer's own defaults. With a project, the screen shows
  // what that project would inherit and lets it say otherwise.
  projectId?: number | null;
  // Which app's areas to show. The work app's and the reading app's have
  // different audiences, so they are never mixed in one list.
  surface: "work" | "viewer";
}) {
  const [areas, setAreas] = useState<NotificationAreas | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const load = useCallback(async () => {
    try {
      setAreas(await notificationService.areas(projectId, surface));
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : "Could not load", type: "error" });
    }
  }, [projectId, surface]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = async (area: string, enabled: boolean, thresholdDays: number | null) => {
    setSaving(area);
    try {
      setAreas(await notificationService.setArea({ area, enabled, projectId, thresholdDays }));
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : "Could not save", type: "error" });
    } finally {
      setSaving(null);
    }
  };

  const follow = async (area: string) => {
    if (!projectId) return;
    setSaving(area);
    try {
      setAreas(await notificationService.clearArea(area, projectId));
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : "Could not reset", type: "error" });
    } finally {
      setSaving(null);
    }
  };

  if (!areas) {
    return <p className="py-6 text-center text-sm text-gray-400">Loading...</p>;
  }

  return (
    // No card of its own: whatever shows this — a tab panel on Customer
    // Settings, a collapsible panel on a project — already draws one, and
    // two nested boxes read as a mistake.
    <div>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}


      <ul className="divide-y divide-gray-100 dark:divide-gray-800">
        {Object.entries(areas).map(([key, area]) => (
          <li key={key} className="flex items-center gap-3 py-2">
            {/* A fixed width so the switches line up in a column. Left to
                the text, each one would start where its own label happened
                to end, and seven of them would step across the panel. */}
            <p className="w-44 flex-shrink-0 truncate text-sm text-gray-800 dark:text-white/90">
              {area.label}
            </p>

            <p className="min-w-0 flex-1 truncate text-sm italic text-gray-500 dark:text-gray-400">
              {DESCRIPTIONS[key] ?? ""}
            </p>

            <button
              type="button"
              role="switch"
              aria-checked={area.enabled}
              aria-label={area.label}
              disabled={!area.switchable || saving === key}
              onClick={() => toggle(key, !area.enabled, area.threshold_days)}
              className={`relative h-5 w-9 flex-shrink-0 rounded-full transition-colors duration-200 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500/40 ${
                area.enabled ? "bg-brand-500" : "bg-gray-300 dark:bg-gray-700"
              } ${!area.switchable ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`}
            >
              {/* `left` rather than a transform, and an explicit width and
                  height: positioned absolutely with neither, the knob falls
                  wherever its static position happens to be and slides out
                  of the track. */}
              <span
                className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-[left] duration-200 ${
                  area.enabled ? "left-[18px]" : "left-0.5"
                }`}
              />
            </button>

            {area.threshold_days !== null && area.switchable && (
              <span className="flex-shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500 dark:bg-white/[0.06] dark:text-gray-400">
                after {area.threshold_days} days
              </span>
            )}


            {/* A project that has said something of its own can go back to
                following the customer. "Off" and "follow the customer" are
                different answers, and a switch alone cannot say the second. */}
            {projectId && area.switchable && area.decided_by === "project" && (
              <button
                type="button"
                onClick={() => follow(key)}
                disabled={saving === key}
                className="flex-shrink-0 text-xs text-brand-500 hover:text-brand-600"
              >
                Follow customer
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
