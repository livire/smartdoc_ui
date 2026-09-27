import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import PageMeta from "../components/common/PageMeta";
import Toast from "../components/common/Toast";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "../components/ui/table";
import Badge from "../components/ui/badge/Badge";
import Checkbox from "../components/form/input/Checkbox";
import { ChevronDownIcon } from "../icons";
import { useAuth } from "../context/AuthContext";
import { useProject } from "../context/ProjectContext";
import { useCustomer, storedCustomerUrl } from "../context/CustomerContext";
import { authService } from "../services/authService";
import { documentService } from "../services/documentService";
import {
  assignmentStageService,
  MyAssignment,
  AssignmentStatus,
  ASSIGNMENT_STATUS_LABELS,
  ASSIGNMENT_STATUS_COLORS,
} from "../services/assignmentStageService";
import { assignmentLabel } from "../services/assignmentService";

// Labels and colours live in assignmentStageService so this screen, the
// Digitize header and the verifier queue can't drift apart.
const STATUS_LABELS = ASSIGNMENT_STATUS_LABELS;
const STATUS_COLORS = ASSIGNMENT_STATUS_COLORS;

// This screen lists the STAGES assigned to the viewer, so every row is
// something they can act on. "Awaiting review" belongs to the shared queue on
// the dashboard, and finished work lives in My Recent Work below
// (verification-redesign.md §12.4a).
const STATUS_OPTIONS = [
  { value: String(AssignmentStatus.PENDING_CAPTURE), label: STATUS_LABELS[AssignmentStatus.PENDING_CAPTURE] },
  { value: String(AssignmentStatus.CAPTURING), label: STATUS_LABELS[AssignmentStatus.CAPTURING] },
  { value: String(AssignmentStatus.RETURNED_FOR_CORRECTION), label: STATUS_LABELS[AssignmentStatus.RETURNED_FOR_CORRECTION] },
  { value: String(AssignmentStatus.VERIFYING), label: STATUS_LABELS[AssignmentStatus.VERIFYING] },
];

// How far back My Recent Work looks. Plain choices rather than a date range:
// the question is always "recently", never "between the 4th and the 11th".
const RECENT_RANGES = [
  { days: 1, label: "Last 24 hours" },
  { days: 3, label: "Last 3 days" },
  { days: 7, label: "Last week" },
  { days: 30, label: "Last month" },
];

function FilterDropdown({
  idPrefix,
  placeholder,
  allLabel,
  options,
  selected,
  onChange,
}: {
  idPrefix: string;
  placeholder: string;
  allLabel: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        buttonRef.current &&
        !buttonRef.current.contains(target) &&
        panelRef.current &&
        !panelRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  const openDropdown = () => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setCoords({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
    setIsOpen((prev) => !prev);
  };

  const toggleValue = (value: string) => {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  };

  const summary =
    selected.length === 0
      ? placeholder
      : selected.length === options.length
      ? allLabel
      : options
          .filter((o) => selected.includes(o.value))
          .map((o) => o.label)
          .join(", ");

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={openDropdown}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-gray-300 bg-transparent px-3 text-sm text-gray-800 shadow-theme-xs focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
      >
        <span className={`truncate ${selected.length === 0 ? "text-gray-400 dark:text-gray-500" : ""}`}>
          {summary}
        </span>
        <ChevronDownIcon
          className={`size-4 shrink-0 text-gray-500 transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>
      {isOpen &&
        createPortal(
          <div
            ref={panelRef}
            style={{ position: "fixed", top: coords.top, left: coords.left, width: Math.max(coords.width, 224) }}
            className="z-99999 max-h-64 overflow-y-auto rounded-lg border border-gray-200 bg-white p-2 shadow-lg dark:border-gray-700 dark:bg-gray-900"
          >
            {options.length === 0 ? (
              <p className="px-2 py-1.5 text-sm text-gray-500 dark:text-gray-400">No options</p>
            ) : (
              <>
                <div className="mb-1 flex items-center justify-between border-b border-gray-100 px-2 pb-2 dark:border-gray-800">
                  <button
                    type="button"
                    onClick={() =>
                      onChange(selected.length === options.length ? [] : options.map((o) => o.value))
                    }
                    className="text-xs font-medium text-brand-500 hover:underline"
                  >
                    {selected.length === options.length ? "Clear all" : "Select all"}
                  </button>
                </div>
                {options.map((opt) => (
                  <div key={opt.value} className="rounded px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-white/[0.03]">
                    <Checkbox
                      id={`${idPrefix}-${opt.value}`}
                      label={opt.label}
                      checked={selected.includes(opt.value)}
                      onChange={() => toggleValue(opt.value)}
                    />
                  </div>
                ))}
              </>
            )}
          </div>,
          document.body
        )}
    </>
  );
}

export default function MyAssignments() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { project } = useProject();
  const { customer } = useCustomer();
  const base = `/${customer?.customer_url ?? storedCustomerUrl() ?? ""}`;

  const [assignments, setAssignments] = useState<MyAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);

  // Empty = show everything I hold. The list is already only my open stages,
  // so there is nothing to hide by default.
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [identifierFilter, setIdentifierFilter] = useState<string[]>([]);

  // Resolved directly from the identifier table by ID (not from the
  // project-scoped `identifiers` list below) — an assignment's identifier
  // isn't guaranteed to be in that list (this screen doesn't even filter
  // assignments by project), so a Map lookup against it can miss.
  const [identifierValues, setIdentifierValues] = useState<Map<string, string>>(new Map());

  const [recent, setRecent] = useState<MyAssignment[]>([]);
  const [recentDays, setRecentDays] = useState(7);
  const [loadingRecent, setLoadingRecent] = useState(false);

  // Already scoped to this user by the server — nothing left to filter out.
  const myAssignments = assignments;

  // Options for the Identifier filter — built from the identifiers actually
  // referenced by the user's assignments (via identifierValues), not the
  // current project's identifier list, since assignments aren't scoped to
  // whichever project happens to be selected.
  const identifierOptions = useMemo(() => {
    const uniqueIds = Array.from(new Set(myAssignments.map((a) => String(a.identifier_id))));
    return uniqueIds.map((id) => ({
      value: id,
      label: identifierValues.get(id) || `#${id}`,
    }));
  }, [myAssignments, identifierValues]);

  const filteredAssignments = useMemo(() => {
    const rows = myAssignments.filter((a) => {
      if (statusFilter.length > 0 && !statusFilter.includes(String(a.assignment_status))) return false;
      if (identifierFilter.length > 0 && !identifierFilter.includes(String(a.identifier_id))) return false;
      return true;
    });

    // Corrections first: a send-back is the most urgent thing to hold, because
    // a verifier is already waiting on it. Then in-progress, then the rest.
    const urgency = (a: MyAssignment) =>
      a.assignment_status === AssignmentStatus.RETURNED_FOR_CORRECTION
        ? 0
        : a.assignment_status === AssignmentStatus.CAPTURING
        ? 1
        : 2;

    return [...rows].sort((a, b) => urgency(a) - urgency(b) || a.assignment_id - b.assignment_id);
  }, [myAssignments, statusFilter, identifierFilter]);

  const loadAll = async () => {
    if (!project || !user?.user_id) return;
    setLoading(true);
    setError(null);
    try {
      const token = await authService.ensureValidToken();
      // Server-side, derived from the stages this user holds — not the whole
      // project's assignments filtered by `assigned_to` on the client.
      const mine = await assignmentStageService.getMyWork(project.project_id, token);
      setAssignments(mine);

      const uniqueIdentifierIds = Array.from(new Set(mine.map((a) => a.identifier_id)));
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
      setIdentifierValues(new Map(resolved.filter((entry): entry is [string, string] => !!entry[1])));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load assignments");
    } finally {
      setLoading(false);
    }
  };

  const loadRecent = async () => {
    if (!project || !user?.user_id) return;
    setLoadingRecent(true);
    try {
      const token = await authService.ensureValidToken();
      const rows = await assignmentStageService.getMyRecentWork(project.project_id, recentDays, token);
      setRecent(rows);

      // Recent rows can reference identifiers the open list doesn't, so
      // resolve any that are missing rather than showing a bare #id.
      const missing = Array.from(new Set(rows.map((r) => r.identifier_id))).filter(
        (id) => !identifierValues.has(String(id))
      );
      if (missing.length > 0) {
        const resolved = await Promise.all(
          missing.map(async (id) => {
            try {
              const identifier = await documentService.getIdentifierById(id, token);
              return [String(id), identifier?.identifier_value] as const;
            } catch {
              return [String(id), undefined] as const;
            }
          })
        );
        setIdentifierValues((prev) => {
          const next = new Map(prev);
          resolved.forEach(([id, value]) => value && next.set(id, value));
          return next;
        });
      }
    } catch {
      // Recent work is context, not the job — a failure here shouldn't take
      // the screen down with it.
      setRecent([]);
    } finally {
      setLoadingRecent(false);
    }
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, user?.user_id]);

  useEffect(() => {
    loadRecent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, user?.user_id, recentDays]);



  return (
    <div className="flex flex-col flex-1 w-full bg-gray-50 dark:bg-gray-900 overflow-hidden min-w-0 min-h-0">
      <PageMeta title="My Assignments | SmartDoc" description="Assignments assigned to you" />

      {/* Header */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4 min-w-0 flex-shrink-0 w-full">
        <div className="flex items-start gap-4">
          <div className="w-56">
            <FilterDropdown
              idPrefix="status"
              placeholder="Select statuses"
              allLabel="All statuses"
              options={STATUS_OPTIONS}
              selected={statusFilter}
              onChange={setStatusFilter}
            />
          </div>
          <div className="w-56">
            <FilterDropdown
              idPrefix="identifier"
              placeholder="Select identifiers"
              allLabel="All identifiers"
              options={identifierOptions}
              selected={identifierFilter}
              onChange={setIdentifierFilter}
            />
          </div>
        </div>
        {error && <Toast message={error} type="error" onClose={() => setError(null)} />}
      </div>

      {/* Body: what I have to do */}
      <div className="bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 w-full overflow-auto flex-1 min-w-0">
        <Table>
          <TableHeader className="border-b border-gray-100 dark:border-gray-800">
            <TableRow>
              <TableCell isHeader className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                ID
              </TableCell>
              <TableCell isHeader className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                Identifier
              </TableCell>
              <TableCell isHeader className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                Captured by
              </TableCell>
              <TableCell isHeader className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                Status
              </TableCell>
              <TableCell isHeader className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                Assigned On
              </TableCell>
              <TableCell isHeader className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                Notes
              </TableCell>
              <TableCell isHeader className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
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
                  {myAssignments.length === 0 ? "No assignments found" : "No assignments match the selected filters"}
                </TableCell>
              </TableRow>
            ) : (
              filteredAssignments.map((a) => (
                <TableRow key={a.assignment_id}>
                  <TableCell className="px-4 py-4 font-mono text-sm text-gray-700 dark:text-gray-300">
                    {assignmentLabel(a)}
                  </TableCell>
                  <TableCell className="px-4 py-4 text-sm text-gray-800 dark:text-white/90">
                    {identifierValues.get(String(a.identifier_id)) || `#${a.identifier_id}`}
                  </TableCell>
                  <TableCell className="px-4 py-4 text-sm text-gray-700 dark:text-gray-300">
                    {/* Only meaningful on a verification — a capture stage is
                        the reader's own work. */}
                    {a.captured_by_username || "—"}
                  </TableCell>
                  <TableCell className="px-4 py-4 text-sm">
                    <div className="flex items-center gap-2">
                      <Badge size="sm" color={STATUS_COLORS[a.assignment_status] || "light"}>
                        {STATUS_LABELS[a.assignment_status] || `Status ${a.assignment_status}`}
                      </Badge>
                      {/* A claimed verification is also "my work", so it lands
                          in this list — say which kind it is, or a review looks
                          like a capture with its buttons greyed out. */}
                      {a.my_stage.stage_type === 2 && (
                        <span className="text-xs text-gray-500 dark:text-gray-400">to verify</span>
                      )}
                      {a.my_stage.round > 1 && (
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          round {a.my_stage.round}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="px-4 py-4 text-sm text-gray-700 dark:text-gray-300">
                    {new Date(a.assignment_date).toLocaleString()}
                  </TableCell>
                  <TableCell className="px-4 py-4 text-sm text-gray-500 dark:text-gray-400">
                    {/* The send-back reason matters more than the original
                        note on a corrections round, so it leads. */}
                    {a.return_reason ? (
                      <span title={a.return_reason} className="block max-w-xs truncate text-warning-600">
                        Sent back: {a.return_reason}
                      </span>
                    ) : (
                      a.assignment_notes || "—"
                    )}
                  </TableCell>
                  <TableCell className="px-4 py-4 text-sm">
                    {/* A claimed verification is a different kind of work, so
                        it gets the one action that applies to it rather than
                        three capture buttons that would all be dead. */}
                    {/* One action: open the screen where this work happens.
                        Starting and closing live there, so the rules for them
                        aren't written in two places. */}
                    <button
                      type="button"
                      title={
                        a.my_stage.stage_type === 2
                          ? "Open this batch to verify"
                          : "Open in Digitize"
                      }
                      onClick={() =>
                        navigate(
                          `${base}${a.my_stage.stage_type === 2 ? `/verify/${a.assignment_id}` : "/digitize"}`
                        )
                      }
                      // Same tint as the dashboard's open buttons, so the two
                      // screens read as one system.
                      className="flex size-6 items-center justify-center rounded-md bg-brand-50 text-brand-500 shadow-theme-xs transition-colors hover:bg-brand-100 active:translate-y-px dark:bg-brand-500/12 dark:text-brand-400 dark:hover:bg-brand-500/20"
                    >
                      {/* The open-folder icon used everywhere else for "take
                          me to it". */}
                      <svg viewBox="0 0 24 24" fill="currentColor" className="size-3.5">
                        <path d="M20 6h-8l-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2zm0 12H4V8h16v10z" />
                      </svg>
                    </button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* My Recent Work — deliberately a separate section, not a filter on the
          list above. Answers "did the batch I closed actually go through?"
          without mixing finished work into what still needs doing. */}
      <div className="flex-shrink-0 border-t border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-medium text-gray-800 dark:text-white/90">My Recent Work</h3>
            <select
              value={String(recentDays)}
              onChange={(e) => setRecentDays(Number(e.target.value))}
              className="h-8 rounded-lg border border-gray-200 bg-transparent px-2 text-xs text-gray-700 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
            >
              {RECENT_RANGES.map((r) => (
                <option key={r.days} value={String(r.days)} className="dark:bg-gray-900">
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {loadingRecent ? "Loading..." : `${recent.length} finished`}
          </span>
        </div>

        <div className="max-h-56 overflow-auto border-t border-gray-100 dark:border-gray-800">
          {!loadingRecent && recent.length === 0 ? (
            <p className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
              Nothing finished in this period
            </p>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {recent.map((r) => (
                <li
                  key={r.my_stage.assignment_stage_id}
                  className="flex items-center gap-4 px-6 py-2.5 text-sm"
                >
                  <span className="w-40 truncate text-gray-800 dark:text-white/90">
                    {identifierValues.get(String(r.identifier_id)) || `#${r.identifier_id}`}
                  </span>
                  <span className="w-24 text-xs text-gray-500 dark:text-gray-400">
                    {r.my_stage.stage_type === 1 ? "Captured" : "Verified"}
                    {r.my_stage.round > 1 ? ` · round ${r.my_stage.round}` : ""}
                  </span>
                  <Badge size="sm" color={STATUS_COLORS[r.assignment_status] || "light"}>
                    {STATUS_LABELS[r.assignment_status] || `Status ${r.assignment_status}`}
                  </Badge>
                  <span className="ml-auto text-xs text-gray-500 dark:text-gray-400">
                    {r.my_stage.completed_at
                      ? new Date(r.my_stage.completed_at).toLocaleString()
                      : "—"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} position="top-center" />
      )}
    </div>
  );
}
