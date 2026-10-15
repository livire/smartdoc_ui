import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, Navigate } from "react-router";
import PageMeta from "../../components/common/PageMeta";
import AuthLayout from "./AuthPageLayout";
import LogoPlaceholder from "../../components/common/LogoPlaceholder";
import UserDropdown from "../../components/header/UserDropdown";
import { useCustomer } from "../../context/CustomerContext";
import { useAuth } from "../../context/AuthContext";
import { useProject } from "../../context/ProjectContext";
import { useMembership } from "../../context/MembershipContext";
import { useTheme } from "../../context/ThemeContext";
import { authService, UserProject } from "../../services/authService";
import { customerService } from "../../services/customerService";
import { userManagementService } from "../../services/userManagementService";

/** What a membership row means, in a word. */
const ROLES: Record<number, string> = {
  1: "Administrator",
  2: "Worker",
  4: "Viewer",
};

// A search box earns its place once the list is long enough to scroll.
const WORTH_SEARCHING = 8;

function Chevron() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4 flex-shrink-0 text-gray-400 dark:text-gray-500"
    >
      <path d="m10 6 6 6-6 6" />
    </svg>
  );
}

/**
 * Where do you want to go?
 *
 * **The same frame as signing in** — the customer's mark at the top, one
 * centred column, SmartDoc's own mark at the bottom — because it is the same
 * moment: somebody is on their way in with one thing to answer. It used to
 * be a page inside the shell, which put the menu on screen already offering
 * the places this screen exists to choose between, before anything knew
 * which one was meant.
 *
 * **Customer Setup is one of the choices.** A customer administrator's work
 * belongs to the customer rather than to any project, so it stands beside
 * the projects instead of being reached from inside one.
 *
 * **Shown only when there is a choice.** One destination means nobody is
 * being asked anything, so this sends them straight there. The count comes
 * from `MembershipContext` — the same one the menu uses to decide whether to
 * show its selector. It was worked out in two places, and they disagreed.
 */
export default function ProjectSelection() {
  const { customerUrl } = useParams<{ customerUrl: string }>();
  const { customer } = useCustomer();
  const { user, isAuthenticated } = useAuth();
  const { setProject } = useProject();
  const { destinations, account } = useMembership();
  const { theme } = useTheme();
  const navigate = useNavigate();

  const [projects, setProjects] = useState<UserProject[]>([]);
  // A membership names a project only by id. The names come from the
  // customer's project list, one request for all of them.
  const [projectNames, setProjectNames] = useState<Map<number, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  // Where to send somebody when there was nothing to choose. Set by an
  // effect, read by the render: choosing writes to the project context, and
  // a write during a render is how a screen redraws itself for ever.
  const [goTo, setGoTo] = useState<string | null>(null);

  const [branding, setBranding] = useState<{
    label: string | null;
    logo: string | null;
    logoDark: string | null;
  }>(() => {
    const cached = customer?.customer_id
      ? customerService.readCachedSettings(customer.customer_id)
      : null;
    return {
      label: cached?.customer_label ?? null,
      logo: cached?.login_logo ?? cached?.menu_logo ?? null,
      logoDark: cached?.login_logo_dark ?? cached?.menu_logo_dark ?? null,
    };
  });
  const shownLogo = theme === "dark" ? branding.logoDark || branding.logo : branding.logo;

  useEffect(() => {
    if (!customer?.customer_id) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await authService.ensureValidToken();
        const settings = await customerService.getSettings(customer.customer_id, token);
        if (!cancelled) {
          setBranding({
            label: settings?.customer_label ?? null,
            logo: settings?.login_logo ?? settings?.menu_logo ?? null,
            logoDark: settings?.login_logo_dark ?? settings?.menu_logo_dark ?? null,
          });
        }
      } catch {
        // The customer's name on its own is a fine heading.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [customer?.customer_id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isAuthenticated || !user) {
        setLoading(false);
        return;
      }
      try {
        const token = await authService.ensureValidToken();
        const [mine, named] = await Promise.all([
          authService.getUserProjects(user.user_id!, token),
          customer?.customer_id
            ? userManagementService
                .getProjectsByCustomer(customer.customer_id, token)
                .catch(() => [])
            : Promise.resolve([]),
        ]);
        if (cancelled) return;
        setProjectNames(new Map(named.map((row) => [row.project_id, row.project_name])));
        setProjects(mine.data ?? []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to fetch projects");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, user, customer?.customer_id]);

  /**
   * One destination is not a choice.
   *
   * Somebody on a single project who does not administer the customer has
   * nowhere else to be, and a list of one row asks them to confirm what was
   * never in doubt. A customer administrator on one project has two places
   * and is shown both.
   */
  useEffect(() => {
    if (loading || error || destinations === null || destinations > 1) return;
    if (projects.length === 1) {
      setProject(projects[0]);
      setGoTo(`/${customerUrl}`);
    } else if (account.is_customer_admin) {
      setGoTo(`/${customerUrl}/customer-settings`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, error, destinations, projects, account.is_customer_admin, customerUrl]);

  // The name comes with the membership. The customer's project list is a
  // fallback for a row that somehow arrived without one, and the id is the
  // last resort — never the first thing somebody reads.
  const nameOf = (proj: UserProject) =>
    proj.project?.project_name ?? projectNames.get(proj.project_id) ?? `Project ${proj.project_id}`;

  const matches = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return projects;
    return projects.filter((p) =>
      (p.project?.project_name ?? projectNames.get(p.project_id) ?? `Project ${p.project_id}`)
        .toLowerCase()
        .includes(query),
    );
  }, [projects, search, projectNames]);

  if (!isAuthenticated || !user) {
    return <Navigate to={`/${customerUrl}`} replace />;
  }
  if (goTo) {
    return <Navigate to={goTo} replace />;
  }

  // Nothing is drawn until the count is known, rather than offering a choice
  // and taking it away a frame later.
  const waiting = loading || destinations === null;

  return (
    <>
      <PageMeta
        title={`Where to? - ${customer?.customer_name ?? ""} | SmartDoc`}
        description="Choose where to go"
      />
      <AuthLayout>
        {/* Their own menu, in the corner rather than a header bar: this is
            the same clean frame as signing in, and somebody who landed here
            as the wrong person still has to be able to leave. */}
        <div className="absolute right-6 top-4 z-10">
          <UserDropdown />
        </div>

        <div className="mx-auto flex w-full max-w-md flex-col justify-center px-6">
          <div className="mb-8 flex justify-center">
            {shownLogo ? (
              <img src={shownLogo} alt="" className="h-20 w-full object-contain" />
            ) : (
              <LogoPlaceholder name={branding.label ?? customer?.customer_name} />
            )}
          </div>

          {waiting ? (
            <span className="flex justify-center">
              <span className="block size-8 animate-spin rounded-full border-4 border-brand-500 border-t-transparent" />
            </span>
          ) : (
            <>
              <h1 className="mb-4 text-center text-lg font-semibold text-gray-900 dark:text-white">
                Where do you want to go?
              </h1>

              {/* Customer Setup first: on a customer that is not set up yet,
                  it is what has to happen before a project is worth
                  opening. */}
              {account.is_customer_admin && (
                <button
                  type="button"
                  onClick={() => navigate(`/${customerUrl}/customer-settings`)}
                  className="mb-2.5 flex w-full items-center gap-3 rounded-lg border border-brand-500/40 bg-brand-500/5 px-4 py-3 text-left transition hover:border-brand-500 hover:bg-brand-500/10"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-gray-900 dark:text-white">
                      Customer Setup
                    </span>
                    <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
                      Projects, storage, users and branding
                    </span>
                  </span>
                  <Chevron />
                </button>
              )}

              {projects.length > WORTH_SEARCHING && (
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search projects..."
                  className="mb-3 h-11 w-full rounded-lg border border-gray-300 px-4 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-3 focus:ring-brand-500/10 dark:border-white/15 dark:text-white dark:placeholder:text-gray-500"
                />
              )}

              {error || projects.length === 0 ? (
                <div className="rounded-lg border border-gray-200 px-4 py-8 text-center dark:border-white/10">
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-100">No projects</p>
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    {account.is_customer_admin
                      ? "This customer has no projects yet, or you are not on one. Make one in Customer Setup above."
                      : "Your administrator has not added you to one yet."}
                  </p>
                </div>
              ) : matches.length === 0 ? (
                <p className="py-4 text-center text-sm text-gray-500 dark:text-gray-400">
                  Nothing matches that.
                </p>
              ) : (
                <ul className="flex flex-col gap-2.5">
                  {matches.map((proj) => (
                    <li key={proj.user_project_id}>
                      <button
                        type="button"
                        onClick={() => {
                          setProject(proj);
                          window.location.href = `/${customerUrl}`;
                        }}
                        className="flex w-full items-center gap-3 rounded-lg border border-gray-300 bg-white px-4 py-3 text-left transition hover:border-brand-500 hover:bg-brand-500/5 dark:border-white/15 dark:bg-gray-900 dark:hover:border-brand-400"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-gray-900 dark:text-white">
                            {nameOf(proj)}
                          </span>
                          <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
                            {ROLES[Number(proj.role_id)] ?? "Member"}
                          </span>
                        </span>
                        <Chevron />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </AuthLayout>
    </>
  );
}
