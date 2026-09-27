import { useEffect, useState } from "react";
import { Modal } from "../ui/modal";
import Button from "../ui/button/Button";
import { authService } from "../../services/authService";
import { verificationService } from "../../services/verificationService";
import { assignmentLabel } from "../../services/assignmentService";

/**
 * The lines icon that opens this dialog wherever it appears, so the two
 * screens that have it (Digitize, Assignments) read as one.
 */
export const NotesHistoryIcon = ({ className = "size-3.5" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M4 4h16v2H4zm0 5h16v2H4zm0 5h10v2H4z" />
  </svg>
);

type Entry = { key: string; who: string | null; when: string | null; what: string; text: string | null };

/**
 * Notes and history for one assignment: what was said about the batch —
 * its notes and every comment — and what happened to it, each hand-off in
 * order with the reason when there was one (a send-back, a decline, a
 * handover request, a cancellation). Read from the verification review,
 * which already gathers all of it with people's names.
 *
 * Loaded when opened rather than with the screen: most sessions never
 * look at it.
 */
export default function NotesHistoryDialog({
  assignment,
  onClose,
}: {
  assignment: { assignment_id: number; assignment_code?: string | null; assignment_notes?: string | null };
  onClose: () => void;
}) {
  const [history, setHistory] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const token = await authService.ensureValidToken();
        const review = await verificationService.getReview(assignment.assignment_id, token);
        const entries: Entry[] = [
          // What people said about the batch as a whole.
          ...review.batch_comments.map((c) => ({
            key: `comment-${c.assignment_comment_id}`,
            who: c.created_by_username ?? null,
            when: c.created_at,
            what: "Note",
            text: c.comment,
          })),
          // And what happened to it: each hand-off, with the reason when
          // there was one.
          ...review.stages
            .filter((st) => st.started_at || st.completed_at || st.notes)
            .map((st) => ({
              key: `stage-${st.assignment_stage_id}`,
              who: st.assigned_to_username ?? null,
              when: st.completed_at || st.started_at,
              what:
                st.stage_status === 4
                  ? `Sent back (round ${st.round})`
                  : st.stage_type === 1
                    ? `Captured (round ${st.round})`
                    : `Verified (round ${st.round})`,
              text: st.notes,
            })),
        ].sort((a, b) => new Date(a.when || 0).getTime() - new Date(b.when || 0).getTime());
        if (!cancelled) setHistory(entries);
      } catch {
        if (!cancelled) setHistory([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [assignment.assignment_id]);

  return (
    <Modal isOpen onClose={onClose} className="max-w-2xl p-6">
      <h3 className="mb-4 pr-10 text-lg font-semibold text-gray-800 dark:text-white/90">
        Notes and History <span className="font-mono">{assignmentLabel(assignment)}</span>
      </h3>

      <div className="max-h-[60vh] space-y-4 overflow-y-auto">
        <div>
          <p className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">Assignment notes</p>
          <p className="whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-sm text-gray-700 dark:bg-white/[0.03] dark:text-gray-300">
            {assignment.assignment_notes || "N/A"}
          </p>
        </div>

        <div>
          <p className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">History</p>
          {loading ? (
            <p className="text-sm text-gray-400 dark:text-gray-500">Loading...</p>
          ) : history.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500">Nothing yet</p>
          ) : (
            <ul className="space-y-2">
              {history.map((entry) => (
                <li key={entry.key} className="rounded-lg border border-gray-200 p-2.5 dark:border-gray-700">
                  <p className="flex flex-wrap items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400">
                    <span className="font-medium text-gray-700 dark:text-gray-300">{entry.who || "Unknown"}</span>
                    <span>{entry.when ? new Date(entry.when).toLocaleString() : ""}</span>
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-white/[0.06]">{entry.what}</span>
                  </p>
                  {entry.text && (
                    <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300">{entry.text}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="mt-5 flex justify-end">
        <Button size="xs" type="button" variant="outline" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  );
}
