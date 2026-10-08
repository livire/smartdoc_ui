import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { useProject } from "../context/ProjectContext";
import PageMeta from "../components/common/PageMeta";
import PageBreadcrumb from "../components/common/PageBreadCrumb";
import Button from "../components/ui/button/Button";
import {
  notificationService,
  describe,
  describeCondition,
  linkFor,
  NotificationEvent,
  NotificationCondition,
} from "../services/notificationService";

/**
 * Everything this person has been told, oldest kept and newest first.
 *
 * Paged on the server from the first version rather than when it hurts. The
 * inbox taught that at 2500 rows: a list somebody keeps is a list that
 * grows, and a screen that sorts client-side has to change its ordering rule
 * as well as its query when paging is finally added.
 *
 * Conditions — a batch waiting, a key expiring — are a separate table and
 * are not built; see ../../smartdoc_context/notifications-design.md.
 */
const SIZE = 20;

// The seven areas, as the API names them. Only the ones that write events
// today are offered: a filter that can never match anything is a filter that
// makes somebody think their notifications are missing.
const AREAS: { value: string; label: string }[] = [
  { value: "", label: "Everything" },
  { value: "my_work", label: "My work" },
  { value: "identifiers", label: "Identifiers" },
];

export default function Notifications() {
  const { customerUrl } = useParams();
  const { project } = useProject();
  const [rows, setRows] = useState<NotificationEvent[]>([]);
  // Things that are wrong now. Not paged — there are rarely many, and they
  // are what somebody came to this screen to deal with, so they sit above
  // the history rather than inside it.
  const [conditions, setConditions] = useState<NotificationCondition[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [area, setArea] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [answer, open] = await Promise.all([
        notificationService.list({
          area: area || undefined,
          unreadOnly,
          page,
          size: SIZE,
        }),
        notificationService.conditions(),
      ]);
      setRows(answer.rows);
      setTotal(answer.total);
      // Narrowed by the same filter, so the heading and the list agree.
      setConditions(area ? open.filter((c) => c.area === area) : open);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load notifications");
    } finally {
      setLoading(false);
    }
  }, [area, unreadOnly, page]);

  useEffect(() => {
    load();
  }, [load]);

  // Changing a filter goes back to the first page. Staying on page 4 of a
  // narrower list shows an empty screen that looks like a fault.
  const changeArea = (value: string) => {
    setArea(value);
    setPage(1);
  };

  /**
   * Opening one is reading it. Updated here before the server answers so the
   * row stops being bold under the click rather than a moment later.
   */
  const markOneRead = async (row: NotificationEvent) => {
    if (row.read_at) return;
    setRows((held) =>
      held.map((r) =>
        r.notification_event_id === row.notification_event_id
          ? { ...r, read_at: new Date().toISOString() }
          : r
      )
    );
    try {
      await notificationService.markRead([row.notification_event_id]);
    } catch {
      // Put it back: a row shown as read that is not would be lost from the
      // unread filter somebody is relying on.
      load();
    }
  };

  const acknowledge = async (c: NotificationCondition) => {
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
      load();
    }
  };

  const pages = Math.max(1, Math.ceil(total / SIZE));

  return (
    <>
      <PageMeta title="Notifications | SmartDoc" description="What has happened that you should know about" />
      <PageBreadcrumb />

      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <select
            value={area}
            onChange={(e) => changeArea(e.target.value)}
            className="h-9 rounded-lg border border-gray-300 bg-transparent px-3 text-sm text-gray-700 dark:border-gray-700 dark:text-gray-300"
          >
            {AREAS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>

          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={unreadOnly}
              onChange={(e) => {
                setUnreadOnly(e.target.checked);
                setPage(1);
              }}
              className="h-4 w-4 rounded border-gray-300"
            />
            Unread only
          </label>

          <span className="ml-auto text-sm text-gray-500 dark:text-gray-400">
            {total} in total
          </span>
          <Button
            size="xs"
            variant="outline"
            onClick={async () => {
              await notificationService.markRead();
              load();
            }}
          >
            Mark all read
          </Button>
        </div>

        {/* What is wrong now, above what has happened. Something still
            broken outranks something that already occurred, and these are
            the rows somebody can actually act on. */}
        {!loading && conditions.length > 0 && (
          <div className="mb-5 rounded-xl border border-warning-500/30 bg-warning-500/5 p-1">
            <ul className="divide-y divide-warning-500/20">
              {conditions.map((c) => {
                const { title, body } = describeCondition(c);
                const seen = Boolean(c.acknowledged_at);
                return (
                  <li
                    key={c.notification_condition_id}
                    className={`flex items-center gap-2.5 px-3 py-2 ${seen ? "opacity-60" : ""}`}
                  >
                    <span
                      className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${
                        seen ? "bg-gray-300 dark:bg-gray-600" : "bg-warning-500"
                      }`}
                    />
                    {/* One line: what it is, then the number, then when.
                        A notification is a glance, not a paragraph — three
                        stacked lines each meant twenty rows of scrolling. */}
                    <span className="min-w-0 flex-1 truncate text-sm text-gray-800 dark:text-white/90">
                      {title}
                      {body && (
                        <span className="ml-2 text-gray-500 dark:text-gray-400">{body}</span>
                      )}
                    </span>
                    <span className="flex-shrink-0 whitespace-nowrap text-xs text-gray-400">
                      since {new Date(c.first_seen_at).toLocaleDateString()}
                    </span>
                    {!seen ? (
                      <button
                        type="button"
                        onClick={() => acknowledge(c)}
                        className="flex-shrink-0 rounded px-1.5 py-0.5 text-xs text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-white/5"
                      >
                        Seen
                      </button>
                    ) : (
                      <span className="w-[38px] flex-shrink-0" />
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {error && <p className="py-6 text-center text-sm text-error-500">{error}</p>}
        {loading && !error && <p className="py-6 text-center text-sm text-gray-400">Loading...</p>}
        {!loading && !error && rows.length === 0 && conditions.length === 0 && (
          <p className="py-10 text-center text-sm text-gray-400">
            {unreadOnly ? "Nothing unread." : "Nothing here yet."}
          </p>
        )}

        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {!loading &&
            rows.map((row) => {
              const { title, body } = describe(row);
              const to = customerUrl ? linkFor(row, customerUrl, project?.project_id ?? null) : null;
              const inner = (
                <div className="flex items-center gap-2.5 py-2">
                  {/* The dot's space is kept when it is read, so titles stay
                      in one column instead of shuffling left as rows are
                      opened. */}
                  <span
                    className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${
                      row.read_at ? "bg-transparent" : "bg-brand-500"
                    }`}
                  />
                  <span
                    className={`min-w-0 flex-1 truncate text-sm ${
                      row.read_at
                        ? "text-gray-500 dark:text-gray-400"
                        : "text-gray-800 dark:text-white/90"
                    }`}
                  >
                    {title}
                    {body && <span className="ml-2 text-gray-500 dark:text-gray-400">{body}</span>}
                  </span>
                  <span className="flex-shrink-0 whitespace-nowrap text-xs text-gray-400">
                    {new Date(row.created_at).toLocaleDateString()}
                  </span>
                </div>
              );

              return (
                <li key={row.notification_event_id}>
                  {to ? (
                    <Link
                      to={to}
                      onClick={() => markOneRead(row)}
                      className="block hover:bg-gray-50 dark:hover:bg-white/5"
                    >
                      {inner}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={() => markOneRead(row)}
                      className="block w-full px-2 text-left hover:bg-gray-50 dark:hover:bg-white/5"
                    >
                      {inner}
                    </button>
                  )}
                </li>
              );
            })}
        </ul>

        {pages > 1 && (
          <div className="mt-4 flex items-center justify-between">
            <Button size="xs" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <span className="text-sm text-gray-500 dark:text-gray-400">
              Page {page} of {pages}
            </span>
            <Button size="xs" variant="outline" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
