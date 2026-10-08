import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import { useProject } from "../../context/ProjectContext";
import { Dropdown } from "../ui/dropdown/Dropdown";
import {
  notificationService,
  describe,
  describeCondition,
  linkFor,
  NotificationEvent,
  NotificationCondition,
} from "../../services/notificationService";

/**
 * The bell: what has happened that this person should know about.
 *
 * Replaces the TailAdmin template's dropdown, which was 380 lines of
 * invented people and never called anything. A control that looks like a
 * feature and is not is worse than an empty one — somebody checks it,
 * believes there is nothing waiting, and stops looking.
 *
 * **Counted, not streamed.** The number is fetched when the header draws,
 * on every move between screens, and every couple of minutes. A batch coming
 * back is not urgent to the second, and a socket held open for everybody all
 * day costs more than the answer is worth.
 *
 * Conditions — a batch waiting, a key expiring — are not here yet; see
 * ../../../smartdoc_context/notifications-design.md.
 */
const REFRESH_MS = 2 * 60 * 1000;

export default function NotificationDropdown() {
  const { customerUrl } = useParams();
  const { project } = useProject();
  const where = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  // Events only. The badge counts conditions too, but they have no read
  // state — so "mark all read" must follow this, not the badge, or it
  // appears with nothing to act on and leaves the number where it was.
  const [unreadEvents, setUnreadEvents] = useState(0);
  const [rows, setRows] = useState<NotificationEvent[] | null>(null);
  // Things that are wrong now, as opposed to things that happened. Pinned
  // above the events below: something still broken outranks something that
  // already occurred.
  const [conditions, setConditions] = useState<NotificationCondition[]>([]);

  const refreshCount = useCallback(async () => {
    // Both halves, because the bell is one number. A warning that a batch
    // has waited three days is not an unread message, but it is certainly
    // something waiting.
    const [events, open] = await Promise.all([
      notificationService.unreadCount(),
      notificationService.conditions(),
    ]);
    setConditions(open);
    setUnreadEvents(events);
    // Acknowledged conditions stay in the list but stop counting. A warning
    // nobody can quiet holds the number up for weeks, and a number that
    // never moves is one people stop reading.
    setUnread(events + open.filter((c) => !c.acknowledged_at).length);
  }, []);

  useEffect(() => {
    refreshCount();
    const timer = window.setInterval(refreshCount, REFRESH_MS);
    return () => window.clearInterval(timer);
    // `where.key` rather than `where.pathname`: coming back to the same
    // screen is also a moment worth re-counting.
  }, [refreshCount, where.key]);

  const open = async () => {
    setIsOpen(true);
    try {
      const page = await notificationService.list({ size: 8 });
      setRows(page.rows);
    } catch {
      // The panel says so below rather than throwing a toast over the
      // screen: nobody opened the bell urgently.
      setRows([]);
    }
  };

  /**
   * Opening one is reading it.
   *
   * Marked here rather than left to "mark all read": somebody who clicks a
   * notification has dealt with it, and finding it still bold afterwards
   * makes the count untrustworthy. The row is updated locally first so the
   * number moves with the click rather than after a round trip.
   */
  const markOneRead = async (row: NotificationEvent) => {
    if (row.read_at) return;
    setUnread((n) => Math.max(0, n - 1));
    setUnreadEvents((n) => Math.max(0, n - 1));
    setRows((held) =>
      held
        ? held.map((r) =>
            r.notification_event_id === row.notification_event_id
              ? { ...r, read_at: new Date().toISOString() }
              : r
          )
        : held
    );
    try {
      await notificationService.markRead([row.notification_event_id]);
    } catch {
      // Put the count back if the server did not agree. Leaving it low
      // would hide something still unread.
      refreshCount();
    }
  };

  /**
   * Stop counting a condition without pretending it is fixed.
   *
   * Shared: one administrator acknowledging an expiring key quiets it for
   * all of them, because it is one fact about the world and three people do
   * not each need to dismiss it.
   */
  const acknowledge = async (c: NotificationCondition) => {
    setUnread((n) => Math.max(0, n - 1));
    setConditions((held) =>
      held.map((row) =>
        row.notification_condition_id === c.notification_condition_id
          ? { ...row, acknowledged_at: new Date().toISOString() }
          : row
      )
    );
    try {
      await notificationService.acknowledgeCondition(c.notification_condition_id);
    } catch {
      refreshCount();
    }
  };

  const markAllRead = async () => {
    await notificationService.markRead();
    // Down to the conditions, not to zero: they are still true, and a badge
    // that cleared them would say the pipeline was fine when it is not.
    setUnread(conditions.filter((c) => !c.acknowledged_at).length);
    setUnreadEvents(0);
    setRows((held) =>
      held ? held.map((row) => ({ ...row, read_at: row.read_at ?? new Date().toISOString() })) : held
    );
  };

  return (
    <div className="relative">
      <button
        aria-label={unread ? `${unread} unread notifications` : "Notifications"}
        className="relative flex items-center justify-center text-gray-500 transition-colors bg-white border border-gray-200 rounded-full dropdown-toggle hover:text-gray-700 h-11 w-11 hover:bg-gray-100 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
        onClick={() => (isOpen ? setIsOpen(false) : open())}
      >
        {/* The number, not a dot. "Something is waiting" sends somebody to
            look; "3 are waiting" lets them decide whether to look now. */}
        {unread > 0 && (
          // Red for something that happened and has not been read; amber
          // when all that is waiting is a condition. The badge should agree
          // with the colours in the list below it, or red stops meaning
          // anything.
          <span
            className={`absolute -right-0.5 -top-0.5 z-10 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white ${
              unreadEvents > 0 ? "bg-error-500" : "bg-warning-500"
            }`}
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
        <svg className="fill-current" width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M10 2.4a1 1 0 0 1 1 1v.37a5.1 5.1 0 0 1 4.1 5v2.37l.97 1.86a.75.75 0 0 1-.66 1.1H4.6a.75.75 0 0 1-.67-1.1l.97-1.86V8.77a5.1 5.1 0 0 1 4.1-5V3.4a1 1 0 0 1 1-1Zm-1.84 13.2a1.85 1.85 0 0 0 3.68 0H8.16Z"
          />
        </svg>
      </button>

      <Dropdown
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        className="absolute -right-[180px] mt-[17px] flex h-[420px] w-[350px] flex-col rounded-2xl border border-gray-200 bg-white p-3 shadow-theme-lg dark:border-gray-800 dark:bg-gray-dark sm:w-[361px] lg:right-0"
      >
        <div className="mb-3 flex items-center gap-3 border-b border-gray-100 pb-3 dark:border-gray-700">
          <h5 className="flex-1 text-lg font-semibold text-gray-800 dark:text-gray-200">
            Notifications
          </h5>
          {unreadEvents > 0 && (
            <button
              type="button"
              onClick={markAllRead}
              className="text-sm text-brand-500 hover:text-brand-600"
            >
              Mark all read
            </button>
          )}
          {customerUrl && (
            <Link
              to={`/${customerUrl}/notifications`}
              onClick={() => setIsOpen(false)}
              className="text-sm text-brand-500 hover:text-brand-600"
            >
              See all
            </Link>
          )}
        </div>

        <ul className="flex flex-col overflow-y-auto">
          {/* Conditions first and unmarked: there is nothing to read, only
              something to fix. */}
          {conditions.map((c) => {
            const { title, body } = describeCondition(c);
            const seen = Boolean(c.acknowledged_at);
            return (
              <li
                key={`c${c.notification_condition_id}`}
                className={`flex items-start gap-2 border-b border-gray-100 p-3 px-2 dark:border-gray-800 ${
                  seen ? "opacity-60" : ""
                }`}
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex items-center gap-2">
                    <span
                      className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${
                        seen ? "bg-gray-300 dark:bg-gray-600" : "bg-warning-500"
                      }`}
                    />
                    <span className="text-sm font-medium text-gray-800 dark:text-white/90">{title}</span>
                  </span>
                  {body && <span className="text-xs text-gray-500 dark:text-gray-400">{body}</span>}
                </span>
                {/* Dismiss, not "mark read": the thing is still true, and it
                    stays here until it is actually fixed — at which point
                    the sweep removes it without anybody doing anything. */}
                {!seen && (
                  <button
                    type="button"
                    title="Seen it — stop counting this"
                    onClick={() => acknowledge(c)}
                    className="flex-shrink-0 rounded px-1.5 py-0.5 text-xs text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-white/5"
                  >
                    Seen
                  </button>
                )}
              </li>
            );
          })}
          {rows === null && (
            <li className="px-2 py-6 text-center text-sm text-gray-400">Loading...</li>
          )}
          {rows !== null && rows.length === 0 && conditions.length === 0 && (
            <li className="px-2 py-6 text-center text-sm text-gray-400">Nothing waiting.</li>
          )}
          {(rows ?? []).map((row) => {
            const { title, body } = describe(row);
            const to = customerUrl ? linkFor(row, customerUrl, project?.project_id ?? null) : null;
            const line = (
              <span className="flex flex-col gap-0.5">
                <span className="flex items-center gap-2">
                  {!row.read_at && <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-brand-500" />}
                  <span className="text-sm font-medium text-gray-800 dark:text-white/90">{title}</span>
                </span>
                {body && (
                  <span className="line-clamp-2 text-xs text-gray-500 dark:text-gray-400">{body}</span>
                )}
                <span className="text-[11px] text-gray-400">
                  {new Date(row.created_at).toLocaleString()}
                </span>
              </span>
            );

            return (
              <li key={row.notification_event_id}>
                {to ? (
                  <Link
                    to={to}
                    onClick={() => {
                      markOneRead(row);
                      setIsOpen(false);
                    }}
                    className="flex gap-3 rounded-lg border-b border-gray-100 p-3 px-2 hover:bg-gray-100 dark:border-gray-800 dark:hover:bg-white/5"
                  >
                    {line}
                  </Link>
                ) : (
                  // Nowhere to go, but still something to read: clicking
                  // marks it so the count does not keep counting it.
                  <button
                    type="button"
                    onClick={() => markOneRead(row)}
                    className="flex w-full gap-3 border-b border-gray-100 p-3 px-2 text-left hover:bg-gray-100 dark:border-gray-800 dark:hover:bg-white/5"
                  >
                    {line}
                  </button>
                )}
              </li>
            );
          })}
        </ul>

      </Dropdown>
    </div>
  );
}
