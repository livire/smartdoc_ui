import React, { useEffect, useState } from "react";
import PageMeta from "../components/common/PageMeta";
import Button from "../components/ui/button/Button";
import Toast from "../components/common/Toast";
import Panel, { TD } from "../components/dashboard/Panel";
import { useAuth } from "../context/AuthContext";
import { useProject } from "../context/ProjectContext";
import { useMembership } from "../context/MembershipContext";
import { uploadService, DeadLetter, QueueHealth } from "../services/uploadService";
import { authService } from "../services/authService";
import { documentService } from "../services/documentService";
import { assignmentLabel, assignmentService } from "../services/assignmentService";
import Pagination from "../components/ui/pagination/Pagination";

/**
 * Documents that were stored but never recorded — what the recording
 * service gave up on, as the dead-letter queue holds it. Its own screen,
 * reached from the notice on the dashboard when there is anything here:
 * a box for it on the dashboard itself was a box that said "nothing" almost
 * every day.
 *
 * **For a project admin only**, and the whole project's. A worker's stuck
 * documents can only be in the batch they are capturing — the server
 * refuses to send a batch on while one is stuck — and Digitize shows those
 * with its own Retry. Retry sends a document back through the queue; the
 * row disappears once the record is written, or comes back with a new
 * reason if it fails again.
 *
 * **Nothing is read until the role is known.** It used to read the queue at
 * once and filter by role, and on a cold load the role had not arrived yet:
 * an admin was shown the worker's view of their own batches — usually
 * nothing — under "Nothing stuck", with documents stuck.
 */
export default function NotRecorded() {
  const { user } = useAuth();
  const { project } = useProject();
  const { membership, loading: roleLoading } = useMembership();

  const [stuck, setStuck] = useState<DeadLetter[]>([]);
  const [queueHealth, setQueueHealth] = useState<QueueHealth | null>(null);
  const [identifierValues, setIdentifierValues] = useState<Map<string, string>>(new Map());
  // The queue's messages carry only the assignment's number; its code —
  // what people call it — comes from the project's assignment list.
  const [assignmentCodes, setAssignmentCodes] = useState<Map<string, string>>(new Map());
  // What this project calls its identifier — "Folio", "MR number" — so the
  // column and the grouping say that rather than the generic word.
  const [identifierLabel, setIdentifierLabel] = useState("Identifier");
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [page, setPage] = useState(1);
  // One of the sizes the rows-per-page picker offers (10, 25, 50, 100). It
  // started at 20, which the picker could not show, so it read 10 over a
  // page of 20 (bug #27).
  const [pageSize, setPageSize] = useState(25);
  // Rows can be read by what they belong to — a batch, a folio, a day —
  // which is how somebody decides whether to retry one or a whole batch.
  const [groupBy, setGroupBy] = useState<"none" | "assignment" | "identifier" | "date">("none");
  // Groups fold away so a long list can be read a batch at a time. Kept
  // by label, so a refresh does not unfold everything.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleGroup = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const identifierOf = (id: number) => identifierValues.get(String(id)) || `#${id}`;
  const assignmentOf = (m: DeadLetter) =>
    m.assignmentId !== null
      ? assignmentLabel({
          assignment_id: Number(m.assignmentId),
          assignment_code: assignmentCodes.get(String(m.assignmentId)) ?? null,
        })
      : "—";
  const dayOf = (m: DeadLetter) => (m.timestamp ? new Date(m.timestamp).toLocaleDateString() : "—");

  // The label a row is grouped under, and the order groups come in: by
  // label, newest day first; rows inside a group newest first.
  const groupKey = (m: DeadLetter) =>
    groupBy === "assignment"
      ? assignmentOf(m)
      : groupBy === "identifier"
        ? m.identifierId !== null
          ? identifierOf(Number(m.identifierId))
          : "—"
        : groupBy === "date"
          ? dayOf(m)
          : "";
  const ordered = [...stuck].sort((a, b) => {
    if (groupBy !== "none") {
      const ka = groupKey(a);
      const kb = groupKey(b);
      if (ka !== kb) {
        if (groupBy === "date") return (b.timestamp ?? "").localeCompare(a.timestamp ?? "");
        return ka.localeCompare(kb);
      }
    }
    return (b.timestamp ?? "").localeCompare(a.timestamp ?? "");
  });
  const groupSizes = new Map<string, number>();
  if (groupBy !== "none") {
    ordered.forEach((m) => {
      const k = groupKey(m);
      groupSizes.set(k, (groupSizes.get(k) ?? 0) + 1);
    });
  }
  const pageRows = ordered.slice((page - 1) * pageSize, page * pageSize);
  const allCollapsed =
    groupSizes.size > 0 && Array.from(groupSizes.keys()).every((k) => collapsed.has(k));

  const load = async () => {
    if (!project || !user?.user_id || !membership.can_setup) return;
    setLoading(true);
    try {
      const token = await authService.ensureValidToken();
      const [{ messages, queue }, details] = await Promise.all([
        uploadService.getDeadLetters({ projectId: project.project_id }, token),
        documentService.getProjectById(project.project_id, token).catch(() => null),
      ]);
      setQueueHealth(queue);
      if (details?.identifier_label) setIdentifierLabel(details.identifier_label);
      setStuck(messages);

      if (messages.length > 0) {
        try {
          const rows = await assignmentService.getByProject(project.project_id, token);
          setAssignmentCodes(
            new Map(
              rows
                .filter((a) => a.assignment_code)
                .map((a) => [String(a.assignment_id), a.assignment_code as string]),
            ),
          );
        } catch {
          // The number will do.
        }
      }

      const ids = Array.from(
        new Set(messages.filter((m) => m.identifierId !== null).map((m) => Number(m.identifierId))),
      );
      const resolved = await Promise.all(
        ids.map(async (id) => {
          try {
            const identifier = await documentService.getIdentifierById(id, token);
            return [String(id), identifier?.identifier_value] as const;
          } catch {
            return [String(id), undefined] as const;
          }
        }),
      );
      setIdentifierValues((prev) => {
        const next = new Map(prev);
        resolved.forEach(([id, value]) => value && next.set(id, value));
        return next;
      });
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : "Could not read the queue", type: "error" });
    } finally {
      setLoading(false);
    }
  };

  const retry = async (filter: { projectId?: number; objectKey?: string }) => {
    const key = filter.objectKey ?? "all";
    setRetrying(key);
    try {
      const token = await authService.ensureValidToken();
      const moved = await uploadService.requeueDeadLetters(filter, token);
      setToast({
        message: moved === 1 ? "Trying 1 document again" : `Trying ${moved} documents again`,
        type: "success",
      });
      // Long enough for the recording service to have another go and
      // either write the row or give up again.
      window.setTimeout(() => load(), 5000);
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : "Could not retry", type: "error" });
    } finally {
      setRetrying(null);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, user?.user_id, membership.can_setup]);

  // The menu does not offer this screen to anybody else; this is for an
  // address typed or a link followed.
  if (roleLoading || !membership.can_setup) {
    return (
      <div className="flex flex-1 items-center justify-center bg-gray-50 p-6 dark:bg-gray-900">
        <PageMeta title="Not Recorded | SmartDoc" description="Documents stored but never recorded" />
        {roleLoading ? (
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-brand-500 dark:border-gray-700 dark:border-t-brand-400" />
        ) : (
          <p className="max-w-md text-center text-sm text-gray-500 dark:text-gray-400">
            This list is for project administrators. Documents in your own batch that were stored but
            not recorded show on Digitize, with a Retry.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 w-full bg-gray-50 dark:bg-gray-900 overflow-hidden min-w-0 min-h-0">
      <PageMeta title="Not Recorded | SmartDoc" description="Documents stored but never recorded" />

      <div className="flex min-h-0 flex-1 flex-col p-0">
        <Panel
          fill
          title="Not Recorded"
          count={stuck.length}
          empty={
            queueHealth && queueHealth.consumers === 0 && queueHealth.waiting > 0
              ? `${queueHealth.waiting} waiting to be recorded and nothing is reading the queue — the recording service needs restarting`
              : "Nothing stuck — every upload has its record"
          }
          loading={loading}
          columns={[identifierLabel, "Assignment", "File", "Date", "Why", ""]}
          headerRight={
            <>
              <label className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                Group by
                <select
                  value={groupBy}
                  onChange={(e) => {
                    setGroupBy(e.target.value as typeof groupBy);
                    setCollapsed(new Set());
                    setPage(1);
                  }}
                  className="h-7 rounded-lg border border-gray-200 bg-transparent px-2 text-xs text-gray-700 focus:border-brand-300 focus:outline-hidden dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
                >
                  <option value="none" className="dark:bg-gray-900">None</option>
                  <option value="assignment" className="dark:bg-gray-900">Assignment</option>
                  <option value="identifier" className="dark:bg-gray-900">{identifierLabel}</option>
                  <option value="date" className="dark:bg-gray-900">Date</option>
                </select>
              </label>
              {groupBy !== "none" && (
                /* One switch: it offers whichever of the two is not the
                   case — collapse while anything is open, expand once
                   everything is folded. */
                <button
                  type="button"
                  onClick={() =>
                    setCollapsed(allCollapsed ? new Set() : new Set(groupSizes.keys()))
                  }
                  className="text-xs text-brand-500 hover:text-brand-600"
                >
                  {allCollapsed ? "Expand all" : "Collapse all"}
                </button>
              )}
              <Button size="xs" variant="outline" disabled={loading} onClick={load}>
                Refresh
              </Button>
              {stuck.length > 1 && (
                <Button
                  size="xs"
                  disabled={retrying !== null || !project}
                  onClick={() => project && retry({ projectId: project.project_id })}
                >
                  {retrying === "all" ? "Retrying..." : "Retry all"}
                </Button>
              )}
            </>
          }
          footer={
            <Pagination
              currentPage={page}
              totalItems={stuck.length}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
              }}
              itemLabel="documents"
            />
          }
        >
          {pageRows.map((m, i) => {
            const key = groupKey(m);
            const startsGroup = groupBy !== "none" && (i === 0 || groupKey(pageRows[i - 1]) !== key);
            const hidden = groupBy !== "none" && collapsed.has(key);
            return (
            <React.Fragment key={m.objectKey}>
            {startsGroup && (
              <tr
                className="cursor-pointer bg-gray-50 hover:bg-gray-100 dark:bg-white/[0.03] dark:hover:bg-white/[0.06]"
                onClick={() => toggleGroup(key)}
              >
                <td colSpan={6} className="px-4 py-2 text-xs font-semibold text-gray-700 dark:text-gray-300">
                  <span className="flex items-center gap-2">
                    {/* Plus to open, minus to close: the sign says what
                        the click will do. */}
                    <span className="flex size-4 items-center justify-center rounded border border-gray-300 text-[11px] leading-none text-gray-500 dark:border-gray-600 dark:text-gray-400">
                      {hidden ? "+" : "−"}
                    </span>
                    {key}
                    <span className="font-normal text-gray-400">{groupSizes.get(key)}</span>
                  </span>
                </td>
              </tr>
            )}
            {!hidden && (
            <tr>
              <td className={`${TD} text-gray-800 dark:text-white/90`}>
                {m.identifierId !== null ? identifierOf(Number(m.identifierId)) : "—"}
              </td>
              <td className={`${TD} font-mono`}>
                {assignmentOf(m)}
              </td>
              <td className={`${TD} max-w-48 truncate`} title={m.objectKey}>
                {m.originalName ?? m.objectKey.split("/").pop()}
              </td>
              {/* When it was uploaded — the message's own stamp, which is
                  also how long it has been stuck. */}
              <td className={TD}>{m.timestamp ? new Date(m.timestamp).toLocaleString() : "—"}</td>
              {/* The last reason the recording service saw. This is what
                  says whether to fix a token, restart a service, or look at
                  the message itself. */}
              <td className={`${TD} max-w-64 truncate text-error-600 dark:text-error-500`} title={m.error ?? undefined}>
                {m.error ?? "unknown"}
                {m.attempts ? ` (${m.attempts} tries)` : ""}
              </td>
              <td className={`${TD} text-right`}>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={retrying !== null}
                  // This one document, by where it is stored. It sent the
                  // row's batch instead, and a document with no batch sent
                  // batch 0 — which the upload service reads as no filter,
                  // so one Retry retried every stuck document in the
                  // project (bug #1). "Retry all" is the button for that.
                  onClick={() => project && retry({ projectId: project.project_id, objectKey: m.objectKey })}
                >
                  {retrying === m.objectKey ? "Retrying..." : "Retry"}
                </Button>
              </td>
            </tr>
            )}
            </React.Fragment>
            );
          })}
        </Panel>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
