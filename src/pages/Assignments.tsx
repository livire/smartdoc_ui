import { useEffect, useMemo, useRef, useState } from "react";
import PageMeta from "../components/common/PageMeta";
import Toast from "../components/common/Toast";
import { Modal } from "../components/ui/modal";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "../components/ui/table";
import Button from "../components/ui/button/Button";
import Badge from "../components/ui/badge/Badge";
import Pagination from "../components/ui/pagination/Pagination";
import Label from "../components/form/Label";
import SearchSelect from "../components/form/SearchSelect";
import CheckSelect from "../components/form/CheckSelect";
import DateRangeFilter, { DateRange } from "../components/form/DateRangeFilter";
import TextArea from "../components/form/input/TextArea";
import NotesHistoryDialog, { NotesHistoryIcon } from "../components/assignments/NotesHistoryDialog";
import { useAuth } from "../context/AuthContext";
import { useCustomer } from "../context/CustomerContext";
import { useProject } from "../context/ProjectContext";
import { authService } from "../services/authService";
import { documentService, Identifier, IdentifierLock } from "../services/documentService";
import { userManagementService, AppUser } from "../services/userManagementService";
import {
  assignmentService,
  Assignment,
  assignmentLabel,
  currentHolder,
} from "../services/assignmentService";
import {
  ASSIGNMENT_STATUS_LABELS as STATUS_LABELS,
  ASSIGNMENT_STATUS_COLORS as STATUS_COLORS,
  assignmentStageService,
} from "../services/assignmentStageService";

// Same spans as My Recent Work on the dashboard, so the two never disagree.
export default function Assignments() {
  const { user } = useAuth();
  const { customer } = useCustomer();
  const { project } = useProject();

  const [identifiers, setIdentifiers] = useState<Identifier[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);

  // Resolved directly from the identifier table by ID (not from the
  // project-scoped `identifiers` list) — an assignment's identifier isn't
  // guaranteed to be in that list, so a Map lookup against it can miss.
  const [identifierValues, setIdentifierValues] = useState<Map<string, string>>(new Map());

  // Tick as many as you like: "the two people on this shift", "everything
  // that isn't finished". One answer each meant asking the same question
  // again for every one of them.
  // null means all of them — including the ones that arrive after the screen
  // draws. Clear ticks nothing off, which shows nothing; that is what an
  // empty set of choices means.
  const [filterUserIds, setFilterUserIds] = useState<string[] | null>(null);
  const [filterIdentifierIds, setFilterIdentifierIds] = useState<string[] | null>(null);
  const [filterStatuses, setFilterStatuses] = useState<string[] | null>(null);
  // One control, one piece of state: the spans and the exact dates are the
  // same question asked two ways.
  const [dates, setDates] = useState<DateRange>({ from: "", to: "" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newIdentifierId, setNewIdentifierId] = useState("");
  const [newAssignedTo, setNewAssignedTo] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [creating, setCreating] = useState(false);
  // Moving a batch to someone else, or ending it. Both need a reason — the
  // people involved have to be able to read afterwards why it moved.
  const [actionOn, setActionOn] = useState<Assignment | null>(null);
  // The assignment whose notes and history are open in the side dialog.
  const [historyOf, setHistoryOf] = useState<Assignment | null>(null);
  const [actionKind, setActionKind] = useState<"handover" | "cancel">("handover");
  const [actionUserId, setActionUserId] = useState("");
  const [actionReason, setActionReason] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  // The rows a supervisor has to do something about: somebody asked to be
  // moved off one, or nobody holds it because it was declined.
  const [needsAttention, setNeedsAttention] = useState(false);

  // Keyed by String(id) — users and assignments come from different
  // endpoints, and MySQL BIGINT columns can serialize as strings from one
  // and numbers from the other, so a strict-type key/lookup can silently miss.
  const userById = useMemo(() => new Map(users.map((u) => [String(u.user_id), u])), [users]);

  const projectIdentifierIds = useMemo(
    () => new Set(identifiers.map((i) => String(i.identifier_id))),
    [identifiers]
  );

  const projectAssignments = useMemo(
    () => assignments.filter((a) => projectIdentifierIds.has(String(a.identifier_id))),
    [assignments, projectIdentifierIds]
  );

  // Every identifier is offered, with the ones that aren't ready shown but
  // not choosable. Filtering them out left the reader wondering whether the
  // identifier existed at all, or was mistyped.
  //
  // `identifier.open` is the lock, and the authority: 0 free, 1 being
  // captured or verified, 2 being sequenced. Only a free file may be handed
  // out. It is not derived from the assignment rows because it cannot be —
  // a file somebody has open on the Sequencing screen has no assignment at
  // all, and deriving would offer it.
  //
  // The assignment rows are still read, but only to name the batch holding
  // it: "being captured" is more use with a code beside it.
  const identifierOptions = useMemo(() => {
    const busy = new Map<string, number>();
    projectAssignments.forEach((a) => {
      const done = a.assignment_status === 6 || a.assignment_status === 7;
      if (!done) busy.set(String(a.identifier_id), a.assignment_status);
    });

    return identifiers.map((i) => {
      const lock = Number(i.open) || IdentifierLock.FREE;
      const held = busy.has(String(i.identifier_id));
      return {
        value: String(i.identifier_id),
        label: i.identifier_value,
        disabled: lock !== IdentifierLock.FREE,
        hint:
          lock === IdentifierLock.SEQUENCING
            ? "being sequenced"
            : lock === IdentifierLock.CAPTURE || held
              ? "being captured"
              : undefined,
      };
    });
  }, [identifiers, projectAssignments]);

  // Filters are kept per project, so coming back to this screen — or
  // reloading it — picks up where the last look left off. Per project
  // because identifier and user ids mean nothing outside the one they were
  // chosen in.
  const filterKey = project?.project_id
    ? `smartdoc.assignmentFilters.${project.project_id}`
    : null;
  // Which project's saved filters are on screen, so the load below runs once
  // per project rather than fighting the save on every change.
  const loadedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!filterKey || loadedFor.current === filterKey) return;
    loadedFor.current = filterKey;

    let saved: {
      users?: string[] | null;
      identifiers?: string[] | null;
      statuses?: string[] | null;
      dates?: DateRange;
      needsAttention?: boolean;
    } | null = null;
    try {
      const raw = localStorage.getItem(filterKey);
      saved = raw ? JSON.parse(raw) : null;
    } catch {
      // A browser that refuses storage still gets working filters.
      saved = null;
    }

    setFilterUserIds(saved?.users ?? null);
    setFilterIdentifierIds(saved?.identifiers ?? null);
    setFilterStatuses(saved?.statuses ?? null);
    setDates(saved?.dates ?? { from: "", to: "" });
    setNeedsAttention(Boolean(saved?.needsAttention));
  }, [filterKey]);

  useEffect(() => {
    if (!filterKey || loadedFor.current !== filterKey) return;
    try {
      localStorage.setItem(
        filterKey,
        JSON.stringify({
          users: filterUserIds,
          identifiers: filterIdentifierIds,
          statuses: filterStatuses,
          dates,
          needsAttention,
        }),
      );
    } catch {
      // Not worth telling anyone about: the filters still work, they just
      // will not be there next time.
    }
  }, [filterKey, filterUserIds, filterIdentifierIds, filterStatuses, dates, needsAttention]);

  const filteredAssignments = useMemo(() => {
    return projectAssignments.filter((a) => {
      if (filterUserIds && !filterUserIds.includes(String(currentHolder(a) ?? ""))) return false;
      if (filterIdentifierIds && !filterIdentifierIds.includes(String(a.identifier_id)))
        return false;
      if (filterStatuses && !filterStatuses.includes(String(a.assignment_status))) return false;

      if (dates.from || dates.to) {
        const on = a.assignment_date ? new Date(a.assignment_date) : null;
        if (!on || Number.isNaN(on.getTime())) return false;
        // A "to" date means the whole of that day, not midnight at its start.
        if (dates.from && on < new Date(`${dates.from}T00:00:00`)) return false;
        if (dates.to && on > new Date(`${dates.to}T23:59:59`)) return false;
      }
      if (needsAttention) {
        const done = a.assignment_status === 6 || a.assignment_status === 7;
        const unheld = currentHolder(a) === null;
        if (done || (a.handover_requested !== 1 && !unheld)) return false;
      }
      return true;
    });
  }, [
    projectAssignments,
    filterUserIds,
    filterIdentifierIds,
    filterStatuses,
    dates,
    needsAttention,
  ]);

  // Paged over what has already been fetched: the assignment list endpoint
  // returns the whole set, so this is presentation only.
  const totalPages = Math.max(1, Math.ceil(filteredAssignments.length / pageSize));

  const pagedAssignments = useMemo(
    () => filteredAssignments.slice((page - 1) * pageSize, page * pageSize),
    [filteredAssignments, page, pageSize],
  );

  // Narrowing the list (or resizing pages) should put you back at the start
  // rather than on a page that no longer exists.
  useEffect(() => {
    setPage(1);
  }, [filterUserIds, filterIdentifierIds, filterStatuses, dates, needsAttention, pageSize]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const loadAll = async () => {
    if (!customer || !project) return;
    setLoading(true);
    setError(null);
    try {
      const token = await authService.ensureValidToken();
      const [identifiersResult, usersResult, assignmentsResult] = await Promise.all([
        documentService.getIdentifiers(project.project_id, token),
        userManagementService.getUsersByCustomer(customer.customer_id, token),
        assignmentService.getByProject(project.project_id, token),
      ]);
      setIdentifiers(identifiersResult.data);
      setUsers(usersResult);
      setAssignments(assignmentsResult);

      // Resolve each assignment's identifier value directly by ID, rather
      // than relying on it being present in the project-scoped identifiers
      // list above.
      const uniqueIdentifierIds = Array.from(new Set(assignmentsResult.map((a) => a.identifier_id)));
      const resolved = await Promise.all(
        uniqueIdentifierIds.map(async (id) => {
          try {
            const identifier = await documentService.getIdentifierById(id, token);
            return [String(id), identifier?.identifier_value] as const;
          } catch {
            return [String(id), undefined] as const;
          }
        })
      );
      setIdentifierValues(
        new Map(resolved.filter((entry): entry is [string, string] => !!entry[1]))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load assignments");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer, project]);

  const openCreate = () => {
    setNewIdentifierId("");
    setNewAssignedTo("");
    setNewNotes("");
    setIsCreateOpen(true);
  };

  const openHandOver = (assignment: Assignment) => {
    setActionOn(assignment);
    setActionKind("handover");
    setActionUserId("");
    setActionReason("");
  };

  const openCancel = (assignment: Assignment) => {
    setActionOn(assignment);
    setActionKind("cancel");
    setActionUserId("");
    setActionReason("");
  };

  /**
   * Move a batch to someone else, or end it.
   *
   * Both are a supervisor's job, and the server enforces that — a worker
   * cannot push half-captured work onto a colleague, and cancelling releases
   * the folio for someone else to be given.
   */
  const submitAction = async () => {
    if (!actionOn || !actionReason.trim()) return;
    if (actionKind === "handover" && !actionUserId) return;

    setActionBusy(true);
    try {
      const token = await authService.ensureValidToken();
      await assignmentStageService.transition(
        actionOn.assignment_id,
        actionKind === "handover" ? "HAND_OVER" : "CANCEL",
        token,
        actionReason.trim(),
        actionKind === "handover" ? Number(actionUserId) : undefined,
      );
      setToast({
        message:
          actionKind === "handover"
            ? `Assignment ${assignmentLabel(actionOn)} handed over successfully`
            : `Assignment ${assignmentLabel(actionOn)} cancelled successfully`,
        type: "success",
      });
      setActionOn(null);
      loadAll();
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : "Could not do that",
        type: "error",
      });
    } finally {
      setActionBusy(false);
    }
  };

  const handleCreateAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newIdentifierId || !newAssignedTo || !user?.user_id) return;

    setCreating(true);
    try {
      const token = await authService.ensureValidToken();
      const created = await assignmentService.create(
        {
          identifier_id: Number(newIdentifierId),
          assigned_to: Number(newAssignedTo),
          assigned_by: user.user_id,
          assignment_notes: newNotes.trim() || undefined,
        },
        token
      );
      setToast({
        message: `Assignment ${assignmentLabel(created)} created successfully`,
        type: "success",
      });
      setIsCreateOpen(false);
      loadAll();
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : "Failed to create assignment",
        type: "error",
      });
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex flex-col flex-1 w-full bg-gray-50 dark:bg-gray-900 overflow-hidden min-w-0 min-h-0">
      <PageMeta title="Assignments | SmartDoc" description="Create and track verification assignments" />

      {/* Header */}
      {/* Not overflow-hidden: the filters' dropdowns hang below this bar, and
          a clipping ancestor cut them off whatever their z-index. */}
      <div className="relative z-20 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4 min-w-0 flex-shrink-0 w-full">
        {/* Two rows: the action on the first, the filters on their own
            beneath. Five controls and a button on one line left everything
            cramped, and at ordinary widths the last of them fell off. */}
        {/* Filters on the left, the action on the right. Wrapping: five
            controls and a button do not fit on one line at every width, and
            the ones that overflowed simply vanished. */}
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            {/* Type-to-search rather than a plain list: a project can have
                thousands of identifiers, and scrolling for one is not a
                filter. */}
            <div className="w-48">
              <CheckSelect
                options={users.map((u) => ({ value: String(u.user_id), label: u.username }))}
                values={filterUserIds}
                onChange={setFilterUserIds}
                noun="users"
                compact
                emptyText="No users match"
              />
            </div>
            <div className="w-56">
              <CheckSelect
                options={identifiers.map((i) => ({
                  value: String(i.identifier_id),
                  label: i.identifier_value,
                }))}
                values={filterIdentifierIds}
                onChange={setFilterIdentifierIds}
                noun="identifiers"
                compact
                emptyText="No identifiers match"
              />
            </div>
            <div className="w-52">
              <CheckSelect
                options={Object.entries(STATUS_LABELS).map(([value, label]) => ({
                  value,
                  label: String(label),
                }))}
                values={filterStatuses}
                onChange={setFilterStatuses}
                noun="statuses"
                compact
                emptyText="No statuses match"
              />
            </div>
            <DateRangeFilter value={dates} onChange={setDates} label="Any date" />
            {/* One click to the pile that needs a decision: batches somebody
                asked to be moved off, and batches nobody is holding because
                they were declined. */}
            <button
              type="button"
              onClick={() => setNeedsAttention((on) => !on)}
              title={
                needsAttention
                  ? "Showing only batches that need a decision — click to show all"
                  : "Show only batches that need a decision: a handover asked for, or nobody holding it"
              }
              className={`flex size-9 items-center justify-center rounded-lg border text-warning-600 transition dark:text-warning-500 ${
                needsAttention
                  ? "border-warning-500 bg-warning-500/20"
                  : "border-warning-500/40 hover:bg-warning-500/10"
              }`}
            >
              {/* A warning triangle: these are the rows waiting on a
                  supervisor, not a filter of convenience. */}
              <svg viewBox="0 0 24 24" fill="currentColor" className="size-4">
                <path d="M12 2.8 1.6 20.8h20.8L12 2.8Zm0 4.9 6.9 11.9H5.1L12 7.7ZM11 10.3v4.4h2v-4.4h-2Zm0 5.6v2h2v-2h-2Z" />
              </svg>
            </button>

            {/* Back to showing everything — not the same as the Clear inside
                a filter, which ticks nothing and so shows nothing. */}
            {(filterUserIds ||
              filterIdentifierIds ||
              filterStatuses ||
              dates.from ||
              dates.to ||
              needsAttention) && (
              <button
                type="button"
                onClick={() => {
                  setFilterUserIds(null);
                  setFilterIdentifierIds(null);
                  setFilterStatuses(null);
                  setDates({ from: "", to: "" });
                  setNeedsAttention(false);
                }}
                className="text-xs text-gray-500 hover:underline dark:text-gray-400"
              >
                Reset filters
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* The list is fetched once on arrival; someone else creating or
                closing an assignment does not reach this screen on its own. */}
            <button
              type="button"
              title="Refresh"
              disabled={loading}
              onClick={loadAll}
              className="flex size-8 items-center justify-center rounded-lg border border-gray-300 text-gray-500 transition hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-white/[0.05]"
            >
              {loading ? (
                <span className="block size-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
              ) : (
                <svg viewBox="0 0 24 24" fill="currentColor" className="size-4">
                  <path d="M17.65 6.35A8 8 0 1 0 19.73 14h-2.08A6 6 0 1 1 12 6a5.9 5.9 0 0 1 4.22 1.78L13 11h7V4z" />
                </svg>
              )}
            </button>

            <Button size="xs" onClick={openCreate}>
              New Assignment
            </Button>
          </div>
        </div>
        {error && <Toast message={error} type="error" onClose={() => setError(null)} />}
      </div>

      {/* Body */}
      <div className="bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 w-full overflow-auto flex-1 min-w-0">
        <Table>
          <TableHeader className="border-b border-gray-100 dark:border-gray-800">
            <TableRow>
              <TableCell isHeader className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                Assignment
              </TableCell>
              <TableCell isHeader className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                Identifier
              </TableCell>
              <TableCell isHeader className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                Assigned To
              </TableCell>
              <TableCell isHeader className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                Assignment Date
              </TableCell>
              <TableCell isHeader className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                Notes
              </TableCell>
              <TableCell isHeader className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                Status
              </TableCell>
              <TableCell isHeader className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400">
                Actions
              </TableCell>
            </TableRow>
          </TableHeader>
          <TableBody className="divide-y divide-gray-100 dark:divide-gray-800">
            {loading ? (
              <TableRow>
                <TableCell className="px-4 py-4 text-sm text-gray-500 dark:text-gray-400" colSpan={7}>
                  Loading assignments...
                </TableCell>
              </TableRow>
            ) : filteredAssignments.length === 0 ? (
              <TableRow>
                <TableCell className="px-4 py-4 text-sm text-gray-500 dark:text-gray-400" colSpan={7}>
                  {projectAssignments.length === 0
                    ? "No assignments found"
                    : "No assignments match the selected filters"}
                </TableCell>
              </TableRow>
            ) : (
              pagedAssignments.map((a) => (
                <TableRow key={a.assignment_id}>
                  <TableCell className="px-4 py-4 font-mono text-sm text-gray-700 dark:text-gray-300">
                    {assignmentLabel(a)}
                  </TableCell>
                  <TableCell className="px-4 py-4 text-sm text-gray-800 dark:text-white/90">
                    {identifierValues.get(String(a.identifier_id)) || `#${a.identifier_id}`}
                  </TableCell>
                  <TableCell className="px-4 py-4 text-sm text-gray-800 dark:text-white/90">
                    {userById.get(String(currentHolder(a)))?.username || "—"}
                  </TableCell>
                  <TableCell className="px-4 py-4 text-sm text-gray-700 dark:text-gray-300">
                    {new Date(a.assignment_date).toLocaleString()}
                  </TableCell>
                  <TableCell className="px-4 py-4 text-sm text-gray-500 dark:text-gray-400">
                    <span className="flex items-center gap-2">
                      {/* Notes and history, for every row — a finished
                          job's story is the one most worth reading. The
                          same icon as on Digitize. */}
                      <button
                        type="button"
                        title="Notes and History"
                        onClick={() => setHistoryOf(a)}
                        className="flex-shrink-0 text-brand-500 hover:text-brand-600"
                      >
                        <NotesHistoryIcon className="size-4" />
                      </button>
                      <span className="block max-w-[14rem] truncate" title={a.assignment_notes || undefined}>
                        {a.assignment_notes || "—"}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell className="px-4 py-4 text-sm">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Badge size="sm" color={STATUS_COLORS[a.assignment_status] || "light"}>
                        {STATUS_LABELS[a.assignment_status] || `Status ${a.assignment_status}`}
                      </Badge>
                      {/* Somebody has said they cannot finish it. Beside the
                          status because that is what a supervisor scans. */}
                      {a.handover_requested === 1 && (
                        <Badge size="sm" color="warning">
                          Handover asked for
                        </Badge>
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="px-4 py-4 text-right text-sm">
                    {/* Only while the job is still alive. A verified or
                        cancelled one is history, and the server refuses both
                        of these on it. */}
                    {a.assignment_status !== 6 && a.assignment_status !== 7 && (
                      <span className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          title="Hand over to someone else"
                          onClick={() => openHandOver(a)}
                          className="p-1.5 rounded text-gray-500 hover:bg-gray-100 hover:text-brand-500 dark:text-gray-400 dark:hover:bg-white/[0.05]"
                        >
                          {/* Two arrows round: from one person to another. */}
                          <svg viewBox="0 0 24 24" fill="currentColor" className="size-4">
                            <path d="M7.5 5.5 4 9h12v2H4l3.5 3.5-1.4 1.4L.2 10 6.1 4.1l1.4 1.4Zm9 13-1.4-1.4L18.6 13H8v-2h10.6l-3.5-3.5 1.4-1.4L22.4 12l-5.9 6.5Z" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          title="Cancel this assignment"
                          onClick={() => openCancel(a)}
                          className="p-1.5 rounded text-gray-500 hover:bg-gray-100 hover:text-error-500 dark:text-gray-400 dark:hover:bg-white/[0.05]"
                        >
                          {/* A circle with a bar: stop. */}
                          <svg viewBox="0 0 24 24" fill="currentColor" className="size-4">
                            <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 2a8 8 0 0 1 6.3 12.9L7.1 5.7A8 8 0 0 1 12 4Zm-6.3 3.1 11.2 11.2A8 8 0 0 1 5.7 7.1Z" />
                          </svg>
                        </button>
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex-shrink-0 border-t border-gray-200 bg-white px-6 dark:border-gray-700 dark:bg-gray-800">
        <Pagination
          currentPage={page}
          totalItems={filteredAssignments.length}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          itemLabel="assignments"
        />
      </div>

      {historyOf && <NotesHistoryDialog assignment={historyOf} onClose={() => setHistoryOf(null)} />}

      {/* Moving a batch to someone else, or ending it. Mounted only while a
          row is chosen: Modal renders its children even when closed, and the
          body reads the chosen assignment. */}
      {actionOn && (
      <Modal isOpen onClose={() => setActionOn(null)} className="max-w-md p-6">
        <h3 className="mb-2 pr-10 text-lg font-semibold text-gray-800 dark:text-white/90">
          {actionKind === "handover" ? "Handover Assignment" : "Cancel Assignment"}{" "}
          <span className="font-mono">{assignmentLabel(actionOn)}</span>
        </h3>
        <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
          {actionKind === "handover"
            ? "The documents already captured stay with the batch, and the new person starts it themselves. The history keeps both names."
            : "The batch ends here. Its documents stay in storage, and the folio is released so it can be assigned again."}
        </p>

        {actionKind === "handover" && (
          <div className="mb-4">
            <Label htmlFor="handover-to">Hand over to *</Label>
            <SearchSelect
              id="handover-to"
              options={users
                .filter((u) => String(u.user_id) !== String(currentHolder(actionOn)))
                .map((u) => ({ value: String(u.user_id), label: u.username }))}
              value={actionUserId}
              onChange={setActionUserId}
              placeholder="Type to search people"
              emptyText="Nobody matches that"
            />
          </div>
        )}

        <TextArea
          rows={3}
          value={actionReason}
          onChange={setActionReason}
          placeholder="Reason"
        />

        <div className="mt-5 flex justify-end gap-2">
          <Button size="xs" variant="outline" onClick={() => setActionOn(null)}>
            Close
          </Button>
          <Button
            size="xs"
            disabled={
              actionBusy ||
              !actionReason.trim() ||
              (actionKind === "handover" && !actionUserId)
            }
            onClick={submitAction}
          >
            {actionBusy
              ? "Working..."
              : actionKind === "handover"
              ? "Hand over"
              : "Cancel assignment"}
          </Button>
        </div>
      </Modal>
      )}

      {/* New Assignment modal */}
      <Modal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} className="max-w-2xl p-6">
        <h3 className="mb-5 pr-10 text-lg font-semibold text-gray-800 dark:text-white/90">
          New Assignment
        </h3>
        <form onSubmit={handleCreateAssignment} className="space-y-4">
          <div>
            <Label htmlFor="identifier">Identifier *</Label>
            <SearchSelect
              id="identifier"
              options={identifierOptions}
              value={newIdentifierId}
              onChange={setNewIdentifierId}
              placeholder="Type to search identifiers"
              emptyText="No identifier matches that"
            />
            <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
              Greyed-out identifiers are in use: an assignment that hasn't been verified, or
              somebody has them open on the Sequencing screen.
            </p>
          </div>
          <div>
            <Label htmlFor="assigned-to">Assign To *</Label>
            <SearchSelect
              id="assigned-to"
              options={users.map((u) => ({ value: String(u.user_id), label: u.username }))}
              value={newAssignedTo}
              onChange={setNewAssignedTo}
              placeholder="Type to search people"
              emptyText="No one matches that"
            />
          </div>
          <div>
            <Label htmlFor="notes">Notes</Label>
            <TextArea value={newNotes} onChange={setNewNotes} rows={3} placeholder="Optional notes" />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button size="xs"
              type="button"
              variant="outline"
              onClick={() => setIsCreateOpen(false)}
              disabled={creating}
            >
              Cancel
            </Button>
            <Button size="xs" type="submit" disabled={creating || !newIdentifierId || !newAssignedTo}>
              {creating ? "Creating..." : "Create"}
            </Button>
          </div>
        </form>
      </Modal>

      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} position="top-center" />
      )}
    </div>
  );
}
