import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useCustomer } from "../context/CustomerContext";
import { useProject } from "../context/ProjectContext";
import { Role } from "../context/MembershipContext";
import { authService } from "../services/authService";
import { userManagementService, Project } from "../services/userManagementService";

/**
 * The projects a person may set up on Categories, Attributes and
 * Identifiers, and the one those screens open on.
 *
 * **Only the projects they administer, opening on the one they are in.**
 * The three screens used to list every project of the customer and open on
 * the first: an administrator of one project was shown another's
 * categories and offered to change them, and on a customer whose first
 * project was not theirs, landed straight on it.
 *
 * This decides what the screen offers, not what is allowed — the API must
 * refuse a change to a project the caller does not run on its own terms.
 */
export function useSetupProjects() {
  const { customer } = useCustomer();
  const { user } = useAuth();
  const { project } = useProject();
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [projectsError, setProjectsError] = useState<string | null>(null);

  useEffect(() => {
    if (!customer || !user?.user_id) return;
    let cancelled = false;
    (async () => {
      setLoadingProjects(true);
      setProjectsError(null);
      try {
        const token = await authService.ensureValidToken();
        const [all, mine] = await Promise.all([
          userManagementService.getProjectsByCustomer(customer.customer_id, token),
          authService.getUserProjects(user.user_id!, token),
        ]);
        if (cancelled) return;
        const runs = new Set(
          (mine.data ?? [])
            .filter((m) => Number(m.role_id) === Role.ADMIN)
            .map((m) => String(m.project_id)),
        );
        const allowed = all.filter((p) => runs.has(String(p.project_id)));
        setProjects(allowed);
        const open = project?.project_id ? String(project.project_id) : "";
        setSelectedProjectId((prev) =>
          prev && allowed.some((p) => String(p.project_id) === prev)
            ? prev
            : allowed.some((p) => String(p.project_id) === open)
              ? open
              : allowed.length > 0
                ? String(allowed[0].project_id)
                : "",
        );
      } catch (err) {
        if (!cancelled) setProjectsError(err instanceof Error ? err.message : "Failed to load projects");
      } finally {
        if (!cancelled) setLoadingProjects(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // The ids, not the objects: a context re-render must not re-fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer?.customer_id, user?.user_id, project?.project_id]);

  return { projects, selectedProjectId, setSelectedProjectId, loadingProjects, projectsError };
}
