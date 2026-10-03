import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import PageMeta from "../components/common/PageMeta";
import Button from "../components/ui/button/Button";
import Toast from "../components/common/Toast";
import { Modal } from "../components/ui/modal";
import { ChevronLeftIcon, CheckLineIcon } from "../icons";
import Pagination from "../components/ui/pagination/Pagination";
import { useCustomer } from "../context/CustomerContext";
import { Role } from "../context/MembershipContext";
import { authService, UserProject } from "../services/authService";
import {
  userManagementService,
  AppUser,
  Project,
} from "../services/userManagementService";

/** What one project row holds, whether or not this person is on it. */
interface Access {
  project_id: number;
  project_name: string;
  user_project_id: number | null;
  member: boolean;
  role_id: number;
  can_comment: boolean;
  can_annotate: boolean;
  can_forward: boolean;
}

const ROLES = [
  { id: Role.ADMIN, label: "Admin" },
  { id: Role.WORKER, label: "Worker" },
  { id: Role.VIEWER, label: "Viewer" },
];

const PRIVILEGES = [
  { field: "can_comment", label: "Comment" },
  { field: "can_annotate", label: "Annotate" },
  { field: "can_forward", label: "Forward" },
] as const;

/**
 * A tick that is a control, not a form element.
 *
 * The browser's own checkbox is a different size and shape on every
 * platform and cannot be styled to sit in a table of this weight. This is
 * a button that looks like what it is.
 */
function Tick({
  on,
  disabled,
  onChange,
  label,
}: {
  on: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`flex size-4 items-center justify-center rounded border transition ${
        on
          ? "border-brand-500 bg-brand-500 text-white"
          : "border-gray-300 bg-white text-transparent hover:border-gray-400 dark:border-gray-600 dark:bg-gray-900"
      } ${disabled ? "cursor-not-allowed opacity-40" : ""}`}
    >
      <CheckLineIcon className="size-3" />
    </button>
  );
}

/**
 * What one person may do, everywhere, on one screen.
 *
 * Every project the customer has is a row — the ones they are on and the
 * ones they are not — so "what can this person see?" is read rather than
 * assembled by clicking through projects one at a time.
 *
 * Changes are held until Save. A screen that writes on every click turns a
 * moment's rethinking into four requests and a half-applied state.
 */
export default function UserAccess() {
  const { customerUrl, userId } = useParams<{ customerUrl: string; userId: string }>();
  const { customer } = useCustomer();
  const navigate = useNavigate();

  const [person, setPerson] = useState<AppUser | null>(null);
  const [rows, setRows] = useState<Access[]>([]);
  // What it looked like when it loaded, to know what actually changed.
  const [asLoaded, setAsLoaded] = useState<Access[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // A customer can have dozens of projects. The list holds a page of them
  // and the footer moves between pages, rather than one long scroll.
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  // Set when somebody tries to leave with changes still on screen. Holding
  // where they were going, so saying "leave" carries on rather than making
  // them press it again.
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      if (!customer || !userId) return;
      setLoading(true);
      try {
        const token = await authService.ensureValidToken();
        const [users, projects, memberships] = await Promise.all([
          userManagementService.getUsersByCustomer(customer.customer_id, token),
          userManagementService.getProjectsByCustomer(customer.customer_id, token),
          userManagementService.getAllUserProjects(token),
        ]);

        setPerson(users.find((u) => String(u.user_id) === String(userId)) ?? null);

        const mine = new Map<string, UserProject>();
        for (const row of memberships) {
          if (String(row.user_id) === String(userId)) mine.set(String(row.project_id), row);
        }

        const built: Access[] = projects.map((p: Project) => {
          const held = mine.get(String(p.project_id));
          return {
            project_id: p.project_id,
            project_name: p.project_name,
            user_project_id: held?.user_project_id ?? null,
            member: Boolean(held),
            role_id: Number(held?.role_id ?? Role.WORKER),
            // Null on the column means "whatever the role gives", which is
            // yes — so an unset row shows as on.
            can_comment: (held?.can_comment ?? 1) === 1,
            can_annotate: (held?.can_annotate ?? 1) === 1,
            can_forward: (held?.can_forward ?? 1) === 1,
          };
        });

        setRows(built);
        setAsLoaded(built);
      } catch (err) {
        setToast({
          message: err instanceof Error ? err.message : "Could not read this person's access",
          type: "error",
        });
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [customer, userId]);

  const change = (projectId: number, patch: Partial<Access>) =>
    setRows((was) =>
      was.map((row) => (row.project_id === projectId ? { ...row, ...patch } : row)),
    );

  /**
   * Taking somebody off a project empties the row.
   *
   * A role and three privileges left sitting under an unticked project read
   * as settings that still apply. They do not — there is no membership for
   * them to be about.
   */
  const setMember = (row: Access, member: boolean) =>
    change(
      row.project_id,
      member
        ? { member: true }
        : {
            member: false,
            role_id: Role.WORKER,
            can_comment: true,
            can_annotate: true,
            can_forward: true,
          },
    );

  // Only the rows on this page are drawn. What was changed on another page
  // is still changed — the count on Save is of every row, not of this page.
  const onThisPage = useMemo(
    () => rows.slice((page - 1) * pageSize, page * pageSize),
    [rows, page, pageSize],
  );

  const changed = useMemo(() => {
    return rows.filter((row) => {
      const before = asLoaded.find((r) => r.project_id === row.project_id);
      if (!before) return false;
      return (
        before.member !== row.member ||
        (row.member &&
          (before.role_id !== row.role_id ||
            before.can_comment !== row.can_comment ||
            before.can_annotate !== row.can_annotate ||
            before.can_forward !== row.can_forward))
      );
    });
  }, [rows, asLoaded]);

  const back = `/${customerUrl}/users?user=${userId}`;

  /**
   * Leaving with work on screen.
   *
   * Nothing here is written until Save, so walking away loses it — and the
   * only sign anything is pending is a number on a button somebody has
   * already looked past. Worth one question.
   */
  const goBack = () => {
    if (changed.length > 0) setLeaving(true);
    else navigate(back);
  };

  const save = async () => {
    if (changed.length === 0 || !userId) return;

    setSaving(true);
    try {
      const token = await authService.ensureValidToken();

      for (const row of changed) {
        const before = asLoaded.find((r) => r.project_id === row.project_id)!;

        if (before.member && !row.member) {
          if (before.user_project_id) {
            await userManagementService.removeProjectAssignment(before.user_project_id, token);
          }
          continue;
        }

        const allowed =
          row.role_id === Role.VIEWER
            ? {
                can_comment: row.can_comment ? 1 : 0,
                can_annotate: row.can_annotate ? 1 : 0,
                can_forward: row.can_forward ? 1 : 0,
              }
            : undefined;

        // Newly on a project: create the membership, then set the
        // privileges, since assigning does not carry them.
        if (!before.member && row.member) {
          const made = await userManagementService.assignProject(
            Number(userId),
            row.project_id,
            token,
            row.role_id,
          );
          if (allowed && made?.user_project_id) {
            await userManagementService.updateProjectRole(
              made.user_project_id,
              Number(userId),
              row.project_id,
              row.role_id,
              token,
              allowed,
            );
          }
          continue;
        }

        if (row.user_project_id) {
          await userManagementService.updateProjectRole(
            row.user_project_id,
            Number(userId),
            row.project_id,
            row.role_id,
            token,
            allowed,
          );
        }
      }

      // Read back rather than patching what is on screen: assigning makes
      // ids this screen does not have, and the next save needs them.
      const memberships = await userManagementService.getAllUserProjects(token);
      const mine = new Map<string, UserProject>();
      for (const row of memberships) {
        if (String(row.user_id) === String(userId)) mine.set(String(row.project_id), row);
      }

      const fresh = rows.map((row) => {
        const held = mine.get(String(row.project_id));
        return {
          ...row,
          user_project_id: held?.user_project_id ?? null,
          member: Boolean(held),
          role_id: Number(held?.role_id ?? row.role_id),
          can_comment: (held?.can_comment ?? 1) === 1,
          can_annotate: (held?.can_annotate ?? 1) === 1,
          can_forward: (held?.can_forward ?? 1) === 1,
        };
      });

      setRows(fresh);
      setAsLoaded(fresh);
      setToast({ message: "Access saved", type: "success" });
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : "Could not save",
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  const head =
    "py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500";
  const grid =
    "grid grid-cols-[minmax(14rem,1fr)_16rem_5.5rem_5.5rem_5.5rem] items-center gap-4 px-5";

  return (
    <>
      <PageMeta
        title={`Access — ${person?.username ?? ""} | SmartDoc`}
        description="What this person may do on each project"
      />
      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}

      {/* The same side padding as the table under it, so the name starts
          where the project names do. */}
      <div className="flex h-full flex-col">
      <div className="flex flex-shrink-0 items-center gap-3 px-5">
        {/* The name is the way back to the list. A person's name is what
            somebody clicks when they mean "that person", so it goes where
            the eye already is rather than only in a button at the far
            end. */}
        <h1 className="flex min-w-0 flex-1 items-center gap-2 text-base">
          <Link
            to={back}
            onClick={(event) => {
              if (changed.length === 0) return;
              event.preventDefault();
              setLeaving(true);
            }}
            className="group flex min-w-0 items-center gap-2 font-semibold text-gray-800 transition hover:text-brand-500 dark:text-white/90 dark:hover:text-brand-400"
          >
            {/* An arrow in a box, not a bare chevron beside the letters: at
                this size a lone "<" reads as punctuation in the name. */}
            <span className="flex size-6 flex-shrink-0 items-center justify-center rounded-md border border-gray-200 text-gray-500 transition group-hover:border-brand-500 group-hover:text-brand-500 dark:border-gray-700 dark:text-gray-400">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="size-3.5"
              >
                <path d="M19 12H5" />
                <path d="m11 18-6-6 6-6" />
              </svg>
            </span>
            <span className="truncate">{person?.username ?? "This person"}</span>
          </Link>
        </h1>

        <Button
          size="xs"
          variant="outline"
          className="px-4"
          startIcon={<ChevronLeftIcon className="size-4" />}
          onClick={goBack}
        >
          Back
        </Button>
        <Button
          size="xs"
          disabled={saving || changed.length === 0}
          className="px-4"
          startIcon={<CheckLineIcon className="size-4" />}
          onClick={save}
        >
          {saving ? "Saving..." : changed.length > 0 ? `Save (${changed.length})` : "Save"}
        </Button>
      </div>

      {loading ? (
        <p className="mt-4 px-5 text-sm text-gray-500 dark:text-gray-400">Loading...</p>
      ) : rows.length === 0 ? (
        <p className="mt-4 px-5 text-sm text-gray-500 dark:text-gray-400">
          This customer has no projects yet.
        </p>
      ) : (
        // The table takes whatever height is left and scrolls inside it,
        // so the footer stays where it is rather than being chased down the
        // page by a long list.
        <div className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
          <div
            className={`${grid} min-w-[46rem] border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-white/[0.03]`}
          >
            <div className={head}>Project</div>
            <div className={head}>Role</div>
            <div className={`${head} text-center`}>Comment</div>
            <div className={`${head} text-center`}>Annotate</div>
            <div className={`${head} text-center`}>Forward</div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
          {onThisPage.map((row) => {
            // An administrator has all three whatever is stored; a worker
            // does not open the reading app at all. Only a viewer chooses,
            // and only on a project they are on.
            const decides = row.member && row.role_id === Role.VIEWER;
            const shown = (field: (typeof PRIVILEGES)[number]["field"]) =>
              row.role_id === Role.ADMIN ? true : row.role_id === Role.WORKER ? false : row[field];

            return (
              <div
                key={row.project_id}
                className={`${grid} min-w-[46rem] border-b border-gray-100 transition last:border-b-0 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-white/[0.03] ${
                  row.member ? "" : "opacity-60 hover:opacity-100"
                }`}
              >
                <label className="flex cursor-pointer items-center gap-3 py-1.5">
                  <Tick
                    on={row.member}
                    onChange={(next) => setMember(row, next)}
                    label={`On ${row.project_name}`}
                  />
                  <span className="truncate text-sm text-gray-800 dark:text-white/90">
                    {row.project_name}
                  </span>
                </label>

                {/* Three named choices rather than a dropdown: there are
                    only ever three, and a dropdown hides two of them behind
                    a click for no saving in width. */}
                <div
                  className={`flex rounded-lg bg-gray-100 p-0.5 dark:bg-white/[0.06] ${
                    row.member ? "" : "pointer-events-none"
                  }`}
                >
                  {ROLES.map((role) => (
                    <button
                      key={role.id}
                      type="button"
                      aria-pressed={row.member && row.role_id === role.id}
                      onClick={() => change(row.project_id, { role_id: role.id })}
                      className={`flex-1 rounded-md px-2 py-1 text-xs font-medium transition ${
                        row.member && row.role_id === role.id
                          ? "bg-white text-gray-900 shadow-theme-xs dark:bg-gray-700 dark:text-white"
                          : "text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white"
                      }`}
                    >
                      {role.label}
                    </button>
                  ))}
                </div>

                {PRIVILEGES.map(({ field, label }) => (
                  <div key={field} className="flex justify-center py-1.5">
                    <Tick
                      on={shown(field)}
                      disabled={!decides}
                      onChange={(next) => change(row.project_id, { [field]: next })}
                      label={`${label} on ${row.project_name}`}
                    />
                  </div>
                ))}
              </div>
            );
          })}
          </div>

          <div className="flex-shrink-0 border-t border-gray-200 dark:border-gray-700">
            <Pagination
              currentPage={page}
              totalItems={rows.length}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
              }}
              itemLabel="projects"
            />
          </div>
        </div>
      )}

      </div>

      <Modal isOpen={leaving} onClose={() => setLeaving(false)} className="max-w-sm p-6">
        <h3 className="mb-2 text-lg font-semibold text-gray-800 dark:text-white/90">
          Leave without saving?
        </h3>
        <p className="mb-5 text-sm text-gray-500 dark:text-gray-400">
          {changed.length === 1
            ? "One project has been changed and not saved."
            : `${changed.length} projects have been changed and not saved.`}{" "}
          Leaving now loses those changes.
        </p>

        <div className="flex justify-end gap-3">
          <Button size="xs" variant="outline" onClick={() => setLeaving(false)}>
            Stay
          </Button>
          <Button
            size="xs"
            onClick={async () => {
              setLeaving(false);
              await save();
              navigate(back);
            }}
          >
            Save and leave
          </Button>
          <button
            type="button"
            onClick={() => navigate(back)}
            className="text-sm text-gray-500 underline-offset-2 transition hover:text-error-500 hover:underline dark:text-gray-400"
          >
            Leave
          </button>
        </div>
      </Modal>
    </>
  );
}
