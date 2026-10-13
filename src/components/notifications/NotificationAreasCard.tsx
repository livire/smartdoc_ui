import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from "react";
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

export interface NotificationAreasHandle {
  /** Write every switch changed since this was loaded. */
  save: () => Promise<void>;
  /** Whether anything is waiting to be saved. */
  dirty: boolean;
}

/**
 * **Changes are held until Save**, not written as each switch is pressed.
 *
 * They used to go one at a time, which read oddly on a screen that has a
 * Save button for everything else: half of what somebody changed was
 * already written and half was not, and leaving without pressing Save kept
 * some of it.
 */
const NotificationAreasCard = forwardRef(function NotificationAreasCard({
  projectId = null,
  surface,
}: {
  // Null edits the customer's own defaults. With a project, the screen shows
  // what that project would inherit and lets it say otherwise.
  projectId?: number | null;
  // Which app's areas to show. The work app's and the reading app's have
  // different audiences, so they are never mixed in one list.
  surface: "work" | "viewer";
}, ref: React.Ref<NotificationAreasHandle>) {
  const [areas, setAreas] = useState<NotificationAreas | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  // Switches changed since loading, by area name. Written on Save.
  const [pending, setPending] = useState<Record<string, boolean>>({});
  // Areas a project has asked to follow the customer again.
  const [following, setFollowing] = useState<string[]>([]);

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

  // Held, not sent. Following the customer and setting a switch are
  // different answers, so each clears the other for that area.
  const toggle = (area: string, enabled: boolean) => {
    setPending((held) => ({ ...held, [area]: enabled }));
    setFollowing((held) => held.filter((a) => a !== area));
  };

  const follow = (area: string) => {
    if (!projectId) return;
    setFollowing((held) => (held.includes(area) ? held : [...held, area]));
    setPending((held) => {
      const next = { ...held };
      delete next[area];
      return next;
    });
  };

  const dirty = Object.keys(pending).length > 0 || following.length > 0;

  // What a switch shows: what somebody just set it to, or what was loaded.
  const shown = (area: string, loaded: boolean) => pending[area] ?? loaded;

  useImperativeHandle(ref, () => ({
    dirty,
    save: async () => {
      if (!dirty) return;
      setSaving("all");
      try {
        // One at a time, in order: each answer replaces the whole set, so
        // sending them together would leave the result to whichever
        // finished last.
        let latest: NotificationAreas | null = null;
        for (const area of following) {
          latest = await notificationService.clearArea(area, projectId!);
        }
        for (const [area, enabled] of Object.entries(pending)) {
          latest = await notificationService.setArea({
            area,
            enabled,
            projectId,
            thresholdDays: areas?.[area]?.threshold_days ?? null,
          });
        }
        if (latest) setAreas(latest);
        setPending({});
        setFollowing([]);
      } finally {
        setSaving(null);
      }
    },
  }));

  if (!areas) {
    return <p className="py-6 text-center text-sm text-gray-400">Loading...</p>;
  }

  return (
    // No card of its own: whatever shows this — a tab panel on Customer
    // Settings, a collapsible panel on a project — already draws one, and
    // two nested boxes read as a mistake.
    <div>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}


      {/* One column. The two cards — Admin and Viewer — sit side by side
          on the screens that show them, so splitting the rows again inside
          each one would leave four narrow columns and nowhere for a name. */}
      <ul>
        {Object.entries(areas).map(([key, area]) => (
          <li
            key={key}
            className="flex items-center gap-3 border-b border-gray-100 py-1.5 dark:border-gray-800"
          >
            {/* The name and what it means stacked, not side by side: in two
                columns there is no width for both on one line. */}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-gray-800 dark:text-white/90">
                {area.label}
              </span>
              {DESCRIPTIONS[key] && (
                <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
                  {DESCRIPTIONS[key]}
                </span>
              )}
            </span>

            <button
              type="button"
              role="switch"
              aria-checked={shown(key, area.enabled)}
              aria-label={area.label}
              disabled={!area.switchable || saving !== null}
              onClick={() => toggle(key, !shown(key, area.enabled))}
              className={`relative h-4 w-7 flex-shrink-0 rounded-full transition-colors duration-200 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500/40 ${
                shown(key, area.enabled) ? "bg-brand-500" : "bg-gray-300 dark:bg-gray-700"
              } ${!area.switchable ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`}
            >
              {/* `left` rather than a transform, and an explicit width and
                  height: positioned absolutely with neither, the knob falls
                  wherever its static position happens to be and slides out
                  of the track. */}
              <span
                className={`absolute top-0.5 size-3 rounded-full bg-white shadow-sm transition-[left] duration-200 ${
                  shown(key, area.enabled) ? "left-[14px]" : "left-0.5"
                }`}
              />
            </button>

            {area.threshold_days !== null && area.switchable && (
              <span className="flex-shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-500 dark:bg-white/[0.06] dark:text-gray-400">
                {area.threshold_days}d
              </span>
            )}


            {/* A project that has said something of its own can go back to
                following the customer. "Off" and "follow the customer" are
                different answers, and a switch alone cannot say the second. */}
            {projectId && area.switchable && area.decided_by === "project" && (
              <button
                type="button"
                onClick={() => follow(key)}
                disabled={saving !== null}
                title="Follow the customer's setting"
                className="flex-shrink-0 text-[11px] text-brand-500 hover:text-brand-600"
              >
                Follow
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
});

export default NotificationAreasCard;
