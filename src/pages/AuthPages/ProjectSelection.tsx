import { useEffect, useState } from "react";
import { useParams, Navigate } from "react-router";
import PageMeta from "../../components/common/PageMeta";
import { useCustomer } from "../../context/CustomerContext";
import { useAuth } from "../../context/AuthContext";
import { useProject } from "../../context/ProjectContext";
import { authService, UserProject } from "../../services/authService";
import { userManagementService } from "../../services/userManagementService";
import Pagination from "../../components/ui/pagination/Pagination";
import Input from "../../components/form/input/InputField";
import { ArrowRightIcon } from "../../icons";
import Button from "../../components/ui/button/Button";

export default function ProjectSelection() {
  const { customerUrl } = useParams<{ customerUrl: string }>();
  const { customer } = useCustomer();
  const { user, isAuthenticated } = useAuth();
  const { setProject } = useProject();
  const [projects, setProjects] = useState<UserProject[]>([]);
  // A membership names a project only by id. The names come from the
  // customer's project list, one request for all of them.
  const [projectNames, setProjectNames] = useState<Map<number, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // A customer administrator's work is the customer's — projects, storages,
  // users, branding — so they are never stuck here for want of a project.
  const [isCustomerAdmin, setIsCustomerAdmin] = useState(false);
  // Somebody can be on dozens of projects. The list holds a page of them and
  // the footer moves between pages, rather than one long scroll.
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState("");

  // Matched on the name as shown, which is what somebody scanning the
  // list has in mind — not the id.
  const query = search.trim().toLowerCase();
  const matches = query
    ? projects.filter((proj) =>
        (projectNames.get(proj.project_id) ?? `Project ${proj.project_id}`)
          .toLowerCase()
          .includes(query),
      )
    : projects;

  useEffect(() => {
    const fetchProjects = async () => {
      if (!isAuthenticated || !user) {
        setLoading(false);
        return;
      }

      try {
        const token = await authService.ensureValidToken();
        const userId = user.user_id!;
        const [response, me, named] = await Promise.all([
          authService.getUserProjects(userId, token),
          authService.getMe(token),
          customer?.customer_id
            ? userManagementService
                .getProjectsByCustomer(customer.customer_id, token)
                .catch(() => [])
            : Promise.resolve([]),
        ]);
        setIsCustomerAdmin(Boolean(me.is_customer_admin));
        setProjectNames(new Map(named.map((row) => [row.project_id, row.project_name])));

        if (response.data && response.data.length > 0) {
          setProjects(response.data);
        } else {
          setError("No projects found for this user");
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Failed to fetch projects";
        setError(errorMessage);
      } finally {
        setLoading(false);
      }
    };

    fetchProjects();
  }, [isAuthenticated, user]);

  if (!isAuthenticated || !user) {
    return <Navigate to={`/${customerUrl}`} replace />;
  }

  if (loading) {
    return (
      <>
        <PageMeta title="Select Project | SmartDoc" description="Select a project to continue" />
        <div className="flex flex-1 items-center justify-center">
          <span className="block size-8 rounded-full border-4 border-brand-500 border-t-transparent animate-spin" />
        </div>
      </>
    );
  }

  if ((error || projects.length === 0) && isCustomerAdmin) {
    // Nothing to choose, but plenty to do: send them to the customer's own
    // screens rather than to a dead end.
    return <Navigate to={`/${customerUrl}/customer-settings`} replace />;
  }

  return (
    <>
      <PageMeta
        title={`Select Project - ${customer?.customer_name ?? ""} | SmartDoc`}
        description="Select a project to continue"
      />
      {/* A page inside the app, not a gate in front of it: the header and
          menu are there, so somebody can change their name or password
          before choosing where to work — or without ever choosing, for a
          customer administrator. The list is the whole content, at the
          height the page has. */}
      {/* The list is the whole page: no heading (the menu entry you came
          from says what this is) and no way past it (a customer
          administrator has the menu). */}
      <div className="flex w-full flex-1 flex-col min-h-0">
        <div className="mb-3 w-full max-w-xs flex-shrink-0">
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search projects..."
            compact
          />
        </div>
        {error || projects.length === 0 ? (
          <div className="rounded-lg border border-gray-200 px-4 py-8 text-center dark:border-gray-700">
            <p className="text-sm font-medium text-gray-800 dark:text-white/90">No projects</p>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {error || "No projects available for your account"} — ask your administrator to add you
              to one.
            </p>
          </div>
        ) : (
          <>
            {/* The list takes whatever height is left and scrolls inside it. */}
            <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700">
              {matches.length === 0 && (
                <p className="px-4 py-4 text-sm text-gray-500 dark:text-gray-400">Nothing matches that.</p>
              )}
              {matches.slice((page - 1) * pageSize, page * pageSize).map((proj) => (
                /* Opening is the button, not the row — the same as the
                   customer list: a click while scanning should not open
                   anything. Striped, because a long list of one-line rows
                   is easier to track across when every other one is
                   tinted. */
                <div
                  key={proj.user_project_id}
                  className="flex w-full items-center justify-between gap-3 px-4 py-2.5 transition odd:bg-white even:bg-gray-50 hover:bg-brand-50 dark:odd:bg-gray-900 dark:even:bg-white/[0.03] dark:hover:bg-brand-500/10"
                >
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="truncate text-sm font-medium text-gray-800 dark:text-white/90">
                      {projectNames.get(proj.project_id) ?? `Project ${proj.project_id}`}
                    </span>
                    <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600 dark:bg-white/10 dark:text-gray-300">
                      {proj.role_id === 1 ? "Administrator" : "Worker"}
                    </span>
                  </span>
                  <Button
                    size="xs"
                    variant="outline"
                    className="flex-shrink-0"
                    onClick={() => {
                      setProject(proj);
                      window.location.href = `/${customerUrl}`;
                    }}
                    endIcon={<ArrowRightIcon className="size-4 fill-current" />}
                  >
                    Open
                  </Button>
                </div>
              ))}
            </div>

            <div className="flex-shrink-0">
              <Pagination
                currentPage={page}
                totalItems={matches.length}
                pageSize={pageSize}
                onPageChange={setPage}
                onPageSizeChange={(size) => {
                  setPageSize(size);
                  setPage(1);
                }}
                itemLabel="projects"
              />
            </div>
          </>
        )}
      </div>
    </>
  );
}
