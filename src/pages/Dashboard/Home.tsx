import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import PageMeta from "../../components/common/PageMeta";
import Badge from "../../components/ui/badge/Badge";
import Button from "../../components/ui/button/Button";
import Toast from "../../components/common/Toast";
import Panel, { TD } from "../../components/dashboard/Panel";
import { ArrowRightIcon } from "../../icons";
import { useAuth } from "../../context/AuthContext";
import { useProject } from "../../context/ProjectContext";
import { useMembership } from "../../context/MembershipContext";
import { useCustomer, storedCustomerUrl } from "../../context/CustomerContext";
import { uploadService, DeadLetter, QueueHealth } from "../../services/uploadService";
import { authService } from "../../services/authService";
import { documentService } from "../../services/documentService";
import {
  assignmentStageService,
  ASSIGNMENT_STATUS_LABELS,
  ASSIGNMENT_STATUS_COLORS,
} from "../../services/assignmentStageService";
import { assignmentLabel } from "../../services/assignmentService";
import type { MyAssignment, VerifyQueueItem } from "../../services/assignmentStageService";

// assignment_stage.stage_type
const CAPTURE_STAGE = 1;
const VERIFY_STAGE = 2;

// Same options as My Recent Work's own picker, so the two never disagree.
const RECENT_RANGES = [
  { days: 1, label: "Last 24 hours" },
  { days: 3, label: "Last 3 days" },
  { days: 7, label: "Last week" },
  { days: 30, label: "Last month" },
];

// Row actions are icons, all the same size and shape — a row of worded
// buttons made the table read like a form.
function IconButton({
  title,
  onClick,
  disabled,
  tone = "solid",
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "solid" | "quiet";
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`flex size-6 items-center justify-center rounded-md shadow-theme-xs transition-colors active:translate-y-px disabled:opacity-40 ${
        tone === "solid"
          ? "bg-brand-50 text-brand-500 hover:bg-brand-100 dark:bg-brand-500/12 dark:text-brand-400 dark:hover:bg-brand-500/20"
          : "border border-gray-200 text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-white/[0.05]"
      }`}
    >
      {children}
    </button>
  );
}

export default function Home() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { project } = useProject();
  const { membership } = useMembership();
  const { customer } = useCustomer();
  // Every screen lives under the customer's url; a bare "/digitize" is
  // read as a customer called "digitize".
  const base = `/${customer?.customer_url ?? storedCustomerUrl() ?? ""}`;

  // Captures and verifications together — both are "work assigned to me", and
  // splitting them made the same person look at two boxes to see one workload.
  const [myWork, setMyWork] = useState<MyAssignment[]>([]);
  // Documents stored but never recorded — what the db service gave up on,
  // as the dead-letter queue holds it. An administrator sees the project's;
  // a worker sees only the batches they hold, which is all they can act on.
  const [stuck, setStuck] = useState<DeadLetter[]>([]);
  const [queueHealth, setQueueHealth] = useState<QueueHealth | null>(null);
  const [available, setAvailable] = useState<VerifyQueueItem[]>([]);
  const [recent, setRecent] = useState<MyAssignment[]>([]);
  const [recentDays, setRecentDays] = useState(7);
  const [identifierValues, setIdentifierValues] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Which of the two views of "my work" the first box shows: what is on my
  // plate, or what I have finished lately.
  const [myTab, setMyTab] = useState<"assignments" | "recent">("assignments");
  // How often the dashboard re-reads by itself. Off by default: it is a
  // screen people leave open, and a silent refresh under someone's cursor is
  // worse than a stale number they chose to keep.
  const [autoRefreshOn, setAutoRefreshOn] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(60);
  const [lastLoaded, setLastLoaded] = useState<Date | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const identifierOf = (id: number) => identifierValues.get(String(id)) || `#${id}`;

  // One verification at a time, so the queue's Claim button is offered only
  // when nothing is held. The server enforces it either way.
  const holdsVerification = myWork.some((m) => m.my_stage.stage_type === VERIFY_STAGE);

  const resolveIdentifiers = async (rows: { identifier_id: number }[], token: string) => {
    const ids = Array.from(new Set(rows.map((r) => r.identifier_id)));
    const resolved = await Promise.all(
      ids.map(async (id) => {
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
  };

  const load = async () => {
    if (!project || !user?.user_id) return;
    setLoading(true);
    setError(null);
    try {
      const token = await authService.ensureValidToken();
      const [mine, recentRows, queue] = await Promise.all([
        assignmentStageService.getMyWork(project.project_id, token),
        assignmentStageService.getMyRecentWork(project.project_id, recentDays, token),
        assignmentStageService.getVerifyQueue(project.project_id, token),
      ]);

      const held = mine.filter((m) => m.my_stage.stage_type === VERIFY_STAGE);
      setMyWork(mine);
      setRecent(recentRows);
      // Only what this person could actually take: the queue annotates rows
      // they can't claim rather than hiding them, so listing all of them here
      // would offer work that isn't theirs to have.
      setAvailable(
        queue.filter(
          (q) => q.can_claim !== false && !held.some((h) => h.assignment_id === q.assignment_id)
        )
      );

      await resolveIdentifiers([...mine, ...recentRows], token);

      // The queue, asked separately: it lives in another service, and its
      // being unreachable should not take the rest of the dashboard down.
      try {
        const { messages: letters, queue } = await uploadService.getDeadLetters(
          { projectId: project.project_id },
          token,
        );
        setQueueHealth(queue);
        const heldCapture = new Set(
          mine
            .filter((m) => m.my_stage.stage_type !== VERIFY_STAGE)
            .map((m) => String(m.assignment_id)),
        );
        const visible = membership.can_setup
          ? letters
          : letters.filter((m) => heldCapture.has(String(m.assignmentId)));
        setStuck(visible);
        await resolveIdentifiers(
          visible
            .filter((m) => m.identifierId !== null)
            .map((m) => ({ identifier_id: Number(m.identifierId) })),
          token,
        );
      } catch {
        setStuck([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load your work");
    } finally {
      setLoading(false);
      setLastLoaded(new Date());
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, user?.user_id, recentDays]);

  useEffect(() => {
    if (!autoRefreshOn) return;
    const id = window.setInterval(load, autoRefresh * 1000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefreshOn, autoRefresh, project, user?.user_id, recentDays]);

  const run = async (
    assignmentId: number,
    event: "START_CAPTURE" | "CLOSE_CAPTURE" | "CLAIM_VERIFY" | "RELEASE_VERIFY",
    successMessage: string,
    goTo?: string
  ) => {
    setBusyId(assignmentId);
    try {
      const token = await authService.ensureValidToken();
      await assignmentStageService.transition(assignmentId, event, token);
      setToast({ message: successMessage, type: "success" });
      if (goTo) {
        navigate(`${base}${goTo}`);
        return;
      }
      await load();
    } catch (err) {
      // Shown as-is: "you already have a capture in progress" and "you
      // captured this batch and self-verification is off" both say what to do.
      setToast({ message: err instanceof Error ? err.message : "That didn't work", type: "error" });
      await load();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex flex-col flex-1 w-full bg-gray-50 dark:bg-gray-900 overflow-auto min-w-0 min-h-0">
      <PageMeta title="Dashboard | SmartDoc" description="Your work at a glance" />

      <div className="p-0">
        {error && <Toast message={error} type="error" onClose={() => setError(null)} />}

        {/* Stored but never recorded — what the recording service gave up
            on. Not a box here any more (a box that said "nothing" most days
            earned no glance) but a notice when there is something, leading
            to its own screen. Never dismissable: it clears when the queue
            does. */}
        {!loading && (stuck.length > 0 || (queueHealth && queueHealth.consumers === 0 && queueHealth.waiting > 0)) && (
          <Link
            to={`/${customer?.customer_url ?? storedCustomerUrl() ?? ""}/not-recorded`}
            title="Open the list"
            className="mb-2 flex items-center justify-between gap-3 rounded-lg border border-warning-500/40 bg-warning-500/10 px-3 py-1.5 transition hover:bg-warning-500/20"
          >
            <span className="flex items-center gap-2 text-xs text-gray-800 dark:text-white/90">
              <svg viewBox="0 0 24 24" fill="currentColor" className="size-4 flex-shrink-0 text-warning-600">
                <path d="M12 2 1 21h22L12 2Zm1 14h-2v2h2v-2Zm0-6h-2v5h2v-5Z" />
              </svg>
              {stuck.length > 0
                ? `${stuck.length} ${stuck.length === 1 ? "document is" : "documents are"} stored but not recorded`
                : `${queueHealth!.waiting} waiting to be recorded and nothing is reading the queue — the recording service needs restarting`}
            </span>
            <ArrowRightIcon className="size-4 flex-shrink-0 fill-current text-warning-600" />
          </Link>
        )}

        <div className="grid gap-2">
          {/* One box for everything assigned to me — capture and verification
              alike. They're the same question ("what's mine?") and were only
              ever separate because they came from two screens. */}
          <Panel
            title="My Assignments"
            tabs={[
              { key: "assignments", label: "My Assignments", count: myWork.length },
              { key: "recent", label: "My Recent Work", count: recent.length },
            ]}
            activeTab={myTab}
            onTab={(key) => setMyTab(key as "assignments" | "recent")}
            count={myTab === "assignments" ? myWork.length : recent.length}
            empty={
              myTab === "assignments" ? "Nothing assigned to you right now" : "Nothing finished in this period"
            }
            loading={loading}
            // Full width, with Available to Verify beneath: "what is mine"
            // first, "what could be mine" after it.
            columns={
              myTab === "assignments"
                ? ["ID", "Identifier", "Work", "Status", "Assigned On", "Notes", ""]
                : ["ID", "Identifier", "Did", "Round", "Status", "Finished"]
            }
            headerRight={
              myTab === "recent" ? (
              <select
                value={String(recentDays)}
                onChange={(e) => setRecentDays(Number(e.target.value))}
                className="h-7 rounded-lg border border-gray-200 bg-transparent px-2 text-xs text-gray-700 focus:border-brand-300 focus:outline-hidden dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
              >
                {RECENT_RANGES.map((r) => (
                  <option key={r.days} value={String(r.days)} className="dark:bg-gray-900">
                    {r.label}
                  </option>
                ))}
              </select>
              ) : (
              <>
                {/* When it last read, so a number left on screen for an hour
                    is not mistaken for a live one. */}
                {lastLoaded && !loading && (
                  <span className="text-[11px] text-gray-400 dark:text-gray-500">
                    {lastLoaded.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                )}
                <select
                  value={String(autoRefresh)}
                  onChange={(e) => setAutoRefresh(Number(e.target.value))}
                  disabled={!autoRefreshOn}
                  title={autoRefreshOn ? "How often" : "Turn auto refresh on to choose"}
                  className="h-7 rounded-lg border border-gray-300 bg-transparent px-2 text-[11px] text-gray-600 focus:border-brand-300 focus:outline-hidden disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
                >
                  {!autoRefreshOn && (
                    <option value={String(autoRefresh)} className="dark:bg-gray-900">
                      No
                    </option>
                  )}
                  <option value="60" className="dark:bg-gray-900">1m</option>
                  <option value="300" className="dark:bg-gray-900">5m</option>
                  <option value="600" className="dark:bg-gray-900">10m</option>
                  <option value="1800" className="dark:bg-gray-900">30m</option>
                </select>

                {/* The switch decides whether it happens at all; the list is
                    only asked how often, and says so when it is off. */}
                <label className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={autoRefreshOn}
                    onClick={() => setAutoRefreshOn((on) => !on)}
                    className={`relative h-4 w-7 rounded-full transition ${
                      autoRefreshOn ? "bg-brand-500" : "bg-gray-300 dark:bg-gray-600"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 size-3 rounded-full bg-white transition-all ${
                        autoRefreshOn ? "left-3.5" : "left-0.5"
                      }`}
                    />
                  </button>
                  Auto refresh
                </label>

                <button
                  type="button"
                  title="Refresh"
                  disabled={loading}
                  onClick={load}
                  className="flex size-7 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 disabled:opacity-50 dark:text-gray-400 dark:hover:bg-white/[0.05]"
                >
                  {loading ? (
                    <span className="block size-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" />
                  ) : (
                    <svg viewBox="0 0 24 24" fill="currentColor" className="size-4">
                      <path d="M17.65 6.35A8 8 0 1 0 19.73 14h-2.08A6 6 0 1 1 12 6a5.9 5.9 0 0 1 4.22 1.78L13 11h7V4z" />
                    </svg>
                  )}
                </button>
              </>
              )
            }
          >
            {myTab === "recent" ? (
              <>
            {recent.map((r) => (
              <tr key={r.my_stage.assignment_stage_id}>
                <td className={`${TD} font-mono`}>{assignmentLabel(r)}</td>
                <td className={`${TD} text-gray-800 dark:text-white/90`}>
                  {identifierOf(r.identifier_id)}
                </td>
                <td className={TD}>
                  {r.my_stage.stage_type === CAPTURE_STAGE ? "Captured" : "Verified"}
                </td>
                <td className={TD}>{r.my_stage.round}</td>
                <td className={TD}>
                  <Badge size="sm" color={ASSIGNMENT_STATUS_COLORS[r.assignment_status] || "light"}>
                    {ASSIGNMENT_STATUS_LABELS[r.assignment_status] || r.assignment_status}
                  </Badge>
                </td>
                <td className={TD}>
                  {r.my_stage.completed_at ? new Date(r.my_stage.completed_at).toLocaleString() : "—"}
                </td>
              </tr>
            ))}
              </>
            ) : (
              <>
            {myWork.map((a) => {
              const isVerify = a.my_stage.stage_type === VERIFY_STAGE;
              return (
                <tr key={a.my_stage.assignment_stage_id}>
                  <td className={`${TD} font-mono`}>{assignmentLabel(a)}</td>
                  <td className={`${TD} text-gray-800 dark:text-white/90`}>
                    {identifierOf(a.identifier_id)}
                    {a.my_stage.round > 1 && (
                      <span className="ml-2 text-xs text-gray-500">round {a.my_stage.round}</span>
                    )}
                  </td>
                  <td className={TD}>{isVerify ? "Verify" : "Capture"}</td>
                  <td className={TD}>
                    <Badge size="sm" color={ASSIGNMENT_STATUS_COLORS[a.assignment_status] || "light"}>
                      {ASSIGNMENT_STATUS_LABELS[a.assignment_status] || a.assignment_status}
                    </Badge>
                  </td>
                  <td className={TD}>{new Date(a.assignment_date).toLocaleDateString()}</td>
                  <td className={TD}>
                    {/* Clipped to keep every row the same height; the whole
                        note is in the tooltip. */}
                    <span
                      title={a.assignment_notes || undefined}
                      className="block max-w-[14rem] truncate"
                    >
                      {a.assignment_notes || "—"}
                    </span>
                  </td>
                  <td className={TD}>
                    <div className="flex items-center gap-1.5">
                      {isVerify ? (
                        <>
                          <IconButton
                            title="Open this batch to verify"
                            onClick={() => navigate(`${base}/verify/${a.assignment_id}`)}
                          >
                            <svg viewBox="0 0 24 24" fill="currentColor" className="size-3.5">
                              <path d="M20 6h-8l-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2zm0 12H4V8h16v10z" />
                            </svg>
                          </IconButton>
                          <IconButton
                            title="Release — put it back for someone else"
                            tone="quiet"
                            disabled={busyId === a.assignment_id}
                            onClick={() => run(a.assignment_id, "RELEASE_VERIFY", "Returned to the queue")}
                          >
                            {/* undo arrow, since releasing undoes the claim */}
                            <svg viewBox="0 0 24 24" fill="currentColor" className="size-3.5">
                              <path d="M12 5V1L7 6l5 5V7c3.3 0 6 2.7 6 6s-2.7 6-6 6-6-2.7-6-6H4c0 4.4 3.6 8 8 8s8-3.6 8-8-3.6-8-8-8z" />
                            </svg>
                          </IconButton>
                        </>
                      ) : (
                        // Straight to where the work happens. Digitize starts,
                        // closes and resumes the batch itself, so there is no
                        // reason to stop at a list on the way.
                        <IconButton title="Open in Digitize" onClick={() => navigate(`${base}/digitize`)}>
                          {/* The familiar open-folder icon — same meaning as
                              in any desktop app: take me to it. */}
                          <svg viewBox="0 0 24 24" fill="currentColor" className="size-3.5">
                            <path d="M20 6h-8l-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2zm0 12H4V8h16v10z" />
                          </svg>
                        </IconButton>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
              </>
            )}
          </Panel>

          {/* Available to verify — the queue itself */}
          <Panel
            title="Available to Verify"
            count={available.length}
            empty="Nothing waiting to be verified"
            loading={loading}
            columns={["Identifier", "Captured by", "Documents", "Round", "Sent back for", ""]}
          >
            {available.map((q) => (
              <tr key={q.assignment_stage_id}>
                <td className={`${TD} text-gray-800 dark:text-white/90`}>
                  {q.identifier_value || `#${q.assignment?.identifier_id}`}
                </td>
                <td className={TD}>{q.captured_by_username || "—"}</td>
                <td className={TD}>{q.document_count}</td>
                <td className={TD}>{q.round}</td>
                <td className={TD}>
                  {/* Only set once a batch has bounced — worth seeing before
                      picking it up. */}
                  <span
                    title={q.previous_return_reason || undefined}
                    className="block max-w-[12rem] truncate"
                  >
                    {q.previous_return_reason || "—"}
                  </span>
                </td>
                <td className={TD}>
                  {/* Claiming only moves the batch to My Verifications; the
                      review screen is opened from there, so taking work and
                      starting it stay two separate decisions. */}
                  <Button
                    size="xs"
                    disabled={busyId === q.assignment_id || holdsVerification}
                    onClick={() =>
                      run(q.assignment_id, "CLAIM_VERIFY", "Batch claimed")
                    }
                  >
                    {busyId === q.assignment_id ? "Claiming..." : "Claim"}
                  </Button>
                </td>
              </tr>
            ))}
          </Panel>

        </div>
      </div>

      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} position="top-center" />
      )}
    </div>
  );
}
