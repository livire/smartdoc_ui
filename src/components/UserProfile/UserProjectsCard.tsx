import { useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import Toast from "../common/Toast";
import { useCustomer } from "../../context/CustomerContext";
import { authService } from "../../services/authService";
import { userManagementService, Project } from "../../services/userManagementService";

// The two capacities a membership can have. Per project, not per person: the
// same user may run one project and capture documents on another.
const ROLE_LABELS: Record<number, string> = {
  1: "Admin",
  2: "Worker",
};

/**
 * Every project this person belongs to, and what they are on each.
 *
 * The rest of the app works inside one chosen project, so the role in the
 * header only ever told half the story — this screen is about the account,
 * not about wherever they happen to be working.
 */
export default function UserProjectsCard() {
  const { user } = useAuth();
  const { customer } = useCustomer();
  const [rows, setRows] = useState<{ project: Project | null; roleId: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.user_id || !customer?.customer_id) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const token = await authService.ensureValidToken();
        const [memberships, projects] = await Promise.all([
          authService.getUserProjects(user.user_id!, token),
          userManagementService.getProjectsByCustomer(customer.customer_id, token),
        ]);

        const byId = new Map(projects.map((p) => [p.project_id, p]));
        if (!cancelled) {
          setRows(
            (memberships.data ?? []).map((m) => ({
              project: byId.get(m.project_id) ?? null,
              roleId: m.role_id,
            })),
          );
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load your projects");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.user_id, customer?.customer_id]);

  return (
    <div className="h-full p-5 border border-gray-200 rounded-2xl dark:border-gray-800 lg:p-6">
      <h4 className="mb-4 text-lg font-semibold text-gray-800 dark:text-white/90">User Projects</h4>

      {loading ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">Loading...</p>
      ) : error ? (
        <>
          <p className="text-sm text-gray-500 dark:text-gray-400">Could not load your projects.</p>
          <Toast message={error} type="error" onClose={() => setError(null)} />
        </>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          You are not a member of any project yet.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {rows.map(({ project, roleId }, index) => (
            <li
              key={project?.project_id ?? `unknown-${index}`}
              className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-gray-800 dark:text-white/90">
                  {project?.project_name ?? "A project outside this customer"}
                </span>
                {project && (
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {project.identifier_label}
                    {project.is_active === 0 ? " · inactive" : ""}
                  </span>
                )}
              </span>

              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
                  roleId === 1
                    ? "bg-brand-500/15 text-brand-500"
                    : "bg-gray-100 text-gray-600 dark:bg-white/[0.06] dark:text-gray-300"
                }`}
              >
                {ROLE_LABELS[roleId] ?? `Role ${roleId}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
