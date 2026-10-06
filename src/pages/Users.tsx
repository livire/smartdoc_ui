import { useEffect, useMemo, useState } from "react";
import PageMeta from "../components/common/PageMeta";
import Toast from "../components/common/Toast";
import { Modal } from "../components/ui/modal";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "../components/ui/table";
import Button from "../components/ui/button/Button";
import Label from "../components/form/Label";
import Input from "../components/form/input/InputField";
import { PencilIcon, LockIcon } from "../icons";
import { useCustomer } from "../context/CustomerContext";
import { customerService } from "../services/customerService";
import { Role } from "../context/MembershipContext";
import { authService, UserProject } from "../services/authService";
import {
  userManagementService,
  CUSTOMER_ADMIN_ROLE,
  AppUser,
  Project,
} from "../services/userManagementService";
import type { KeycloakUser } from "../services/userManagementService";
import { useNavigate, useParams, useSearchParams } from "react-router";

// A password to hand over once. Nobody has to invent one, and nobody
// reaches for their usual one: it is replaced at the first sign-in anyway.
// The alphabet leaves out the characters people mistake for each other
// (O/0, l/1/I) because this gets read out loud or copied by hand, and it
// takes one of each kind so a realm policy asking for a digit or a symbol
// is satisfied without anybody having to know the policy.
const PASSWORD_PARTS = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "!@#$%&*?"];

// 14 unless the customer asks for more. The parts below already cover a
// capital, a digit and a symbol, so only the length can fall short.
const generatePassword = (length = 14) => {
  const all = PASSWORD_PARTS.join("");
  const pick = (from: string, count: number) => {
    const numbers = new Uint32Array(count);
    crypto.getRandomValues(numbers);
    return Array.from(numbers, (n) => from[n % from.length]);
  };

  // One from each kind first, then the rest from everything, then shuffled
  // so the kinds are not always in the same places.
  const chars = [
    ...PASSWORD_PARTS.flatMap((part) => pick(part, 1)),
    ...pick(all, length - PASSWORD_PARTS.length),
  ];
  const order = new Uint32Array(chars.length);
  crypto.getRandomValues(order);
  return chars
    .map((char, i) => ({ char, key: order[i] }))
    .sort((a, b) => a.key - b.key)
    .map((c) => c.char)
    .join("");
};

const emptyNewUser = {
  username: "",
  email: "",
  firstName: "",
  lastName: "",
  password: "",
};

/**
 * The three a viewer may or may not have, as small marks.
 *
 * Drawn beside the word rather than in three more columns: this panel is
 * 352px wide and the question is "can they, yes or no", which a tinted or
 * faded icon answers at a glance.
 */
const PRIVILEGE_MARKS = [
  { field: "can_comment", label: "Comment", path: "M20 12a7 7 0 0 1-7 7H8l-4 3v-4.5A7 7 0 0 1 11 5h2a7 7 0 0 1 7 7z" },
  { field: "can_annotate", label: "Annotate", path: "M4 20h4l10-10-4-4L4 16zM14.5 5.5l4 4" },
  { field: "can_forward", label: "Forward", path: "M4 12h12M12 6l6 6-6 6M20 5v14" },
] as const;

export default function Users({
  customerId,
  // Projects are the customer's own business: who works on what is decided
  // by their administrator, not by whoever runs SmartDoc. Given `false`,
  // this screen adds, enables and disables accounts and says no more.
  manageProjects = true,
}: {
  customerId?: number;
  manageProjects?: boolean;
}) {
  // Whose customer this screen is about. The customer in context when one
  // of its own people is using it; named outright when a system
  // administrator is, from /sys — where there is no customer in context at
  // all, by design.
  const { customer: contextCustomer } = useCustomer();
  // What this customer asks of a password. Read from the settings already
  // cached for the sign-in page, so no request is needed to show the rules
  // or to make a temporary password that meets them.
  const passwordRules = useMemo(() => {
    const id = customerId ?? contextCustomer?.customer_id;
    const settings = id ? customerService.readCachedSettings(Number(id)) : null;
    return {
      minLength: Number(settings?.password_min_length ?? 8),
      needsDigit: settings?.password_needs_digit === 1,
      needsSymbol: settings?.password_needs_symbol === 1,
      needsCapital: settings?.password_needs_capital === 1,
    };
  }, [customerId, contextCustomer?.customer_id]);

  // One sentence, shown before anybody types — and before the generated one
  // is handed over, so whoever reads it out knows what the person will have
  // to keep to when they choose their own.
  const passwordRulesText = useMemo(() => {
    const parts: string[] = [];
    if (passwordRules.needsDigit) parts.push("a number");
    if (passwordRules.needsCapital) parts.push("a capital letter");
    if (passwordRules.needsSymbol) parts.push("a symbol");
    const head = `At least ${passwordRules.minLength} characters`;
    return parts.length === 0 ? `${head}.` : `${head}, including ${parts.join(", ")}.`;
  }, [passwordRules]);
  // Held steady: built fresh on every render it was a new object each time,
  // so every effect that depends on it ran again, which fetched, which
  // rendered — the screen flickered and the network tab filled up.
  const customer = useMemo(
    () =>
      customerId
        ? ({ ...contextCustomer, customer_id: customerId } as typeof contextCustomer)
        : contextCustomer,
    [contextCustomer, customerId],
  );

  const [users, setUsers] = useState<AppUser[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [allUserProjects, setAllUserProjects] = useState<UserProject[]>([]);
  // Email and real name come from Keycloak, not the app's own `user` table.
  const [keycloakUsers, setKeycloakUsers] = useState<KeycloakUser[]>([]);
  const [detailsUnavailable, setDetailsUnavailable] = useState<string | null>(null);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);
  const [search, setSearch] = useState("");

  const [togglingUserId, setTogglingUserId] = useState<number | null>(null);

  const navigate = useNavigate();
  const { customerUrl } = useParams<{ customerUrl: string }>();
  // Who to show when the screen opens. Set by the access screen on its way
  // back, so returning lands on the person just being looked at rather than
  // on nobody.
  const [params] = useSearchParams();
  const wanted = params.get("user");
  const [selectedUser, setSelectedUser] = useState<AppUser | null>(null);

  const [isAddUserOpen, setIsAddUserOpen] = useState(false);
  const [newUser, setNewUser] = useState(emptyNewUser);
  const [creatingUser, setCreatingUser] = useState(false);
  // Which person's verification link is being sent, so only their own mark
  // reads "Sending...".
  const [resendingFor, setResendingFor] = useState<string | null>(null);

  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editUsername, setEditUsername] = useState("");
  // What this person may do across the whole customer: projects, storages,
  // users and branding. Separate from their role on any project — that is
  // `editRoleId` above — and the reason they need no project open at all.
  // "" for an ordinary user, whose rights come from their projects.
  const [editCustomerRoleId, setEditCustomerRoleId] = useState<string>("");
  const [savingEdit, setSavingEdit] = useState(false);
  // Setting somebody's password for them. Only for the case with no other
  // way out: they have forgotten it and there is nobody inside their
  // customer who can help.
  const [resetFor, setResetFor] = useState<AppUser | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetting, setResetting] = useState(false);
  const [resetCopied, setResetCopied] = useState(false);

  // The capacity granted on the projects being assigned. One role per
  // membership, so this applies to every project ticked in this dialog —
  // assign again with a different role if someone needs to differ per project.
  // A role for each project ticked, keyed by project id. One role for all
  // of them was wrong: somebody can run one project and only read in
  // another, which is the whole reason the role lives on the membership.

  const [pendingToggle, setPendingToggle] = useState<{ user: AppUser; nextActive: 0 | 1 } | null>(null);


  // Keyed by String(id) — users/projects and user_project rows come from
  // different endpoints, and MySQL BIGINT columns can serialize as strings
  // from one and numbers from the other, so a strict-type key/lookup can
  // silently miss.
  const projectNameById = useMemo(
    () => new Map(projects.map((p) => [String(p.project_id), p.project_name])),
    [projects]
  );

  const projectsByUser = useMemo(() => {
    const map = new Map<string, UserProject[]>();
    allUserProjects.forEach((up) => {
      const key = String(up.user_id);
      const list = map.get(key) || [];
      list.push(up);
      map.set(key, list);
    });
    return map;
  }, [allUserProjects]);

  const selectedUserProjects = selectedUser ? projectsByUser.get(String(selectedUser.user_id)) || [] : [];

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return users;
    return users.filter((u) => {
      const details = keycloakUsers.find((k) =>
        u.keycloak_id ? k.id === u.keycloak_id : k.username === u.username
      );
      return (
        u.username.toLowerCase().includes(query) ||
        String(u.user_id).includes(query) ||
        (details?.email || "").toLowerCase().includes(query) ||
        `${details?.firstName || ""} ${details?.lastName || ""}`.toLowerCase().includes(query)
      );
    });
  }, [users, search, keycloakUsers]);


  const loadAll = async (selectUsername?: string) => {
    if (!customer) return;
    setLoadingUsers(true);
    setError(null);
    try {
      const token = await authService.ensureValidToken();
      const [usersResult, projectsResult, userProjectsResult] = await Promise.all([
        userManagementService.getUsersByCustomer(customer.customer_id, token),
        userManagementService.getProjectsByCustomer(customer.customer_id, token),
        userManagementService.getAllUserProjects(token),
      ]);
      setUsers(usersResult);
      setProjects(projectsResult);
      setAllUserProjects(userProjectsResult);

      // Somebody just created is who the screen should be showing — they
      // were made to be given projects, and that is the next thing anybody
      // does. Matched on the username, which is what was just typed.
      if (selectUsername) {
        const made = usersResult.find((u) => u.username === selectUsername);
        if (made) setSelectedUser(made);
      } else if (wanted) {
        const back = usersResult.find((u) => String(u.user_id) === wanted);
        if (back) setSelectedUser(back);
      }

      // Fetched separately and allowed to fail: it needs `view-users` in
      // Keycloak, which not every project admin has. Losing it costs the
      // name and email columns, nothing else.
      try {
        setKeycloakUsers(await userManagementService.getKeycloakUsers(token));
        setDetailsUnavailable(null);
      } catch (detailErr) {
        setKeycloakUsers([]);
        setDetailsUnavailable(
          detailErr instanceof Error ? detailErr.message : "Names and emails unavailable"
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users");
    } finally {
      setLoadingUsers(false);
    }
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer]);

  // Matched on keycloak_id where there is one; legacy rows predating that
  // column fall back to the username, which Keycloak also keys on.
  const detailsFor = (u: AppUser) =>
    keycloakUsers.find((k) => (u.keycloak_id ? k.id === u.keycloak_id : k.username === u.username));

  const fullName = (u: AppUser) => {
    const d = detailsFor(u);
    return [d?.firstName, d?.lastName].filter(Boolean).join(" ");
  };



  const toggleActive = (u: AppUser) => {
    const nextActive = u.is_active === 1 ? 0 : 1;
    setPendingToggle({ user: u, nextActive });
  };

  const confirmToggleActive = async () => {
    if (!pendingToggle || !customer) return;
    const { user: u, nextActive } = pendingToggle;

    setPendingToggle(null);
    setTogglingUserId(u.user_id);
    try {
      const token = await authService.ensureValidToken();

      // Step 1: sync Keycloak's enabled flag, if this user has a linked
      // keycloak_id (legacy rows created before that column existed won't).
      if (u.keycloak_id) {
        try {
          await userManagementService.setKeycloakUserStatus(u.keycloak_id, nextActive === 1, token);
        } catch (err) {
          setToast({
            message: `Failed to update Keycloak status: ${err instanceof Error ? err.message : "Unknown error"}`,
            type: "error",
          });
          return;
        }
      }

      // Step 2: persist is_active in smartdoc_api's DB. If this fails after
      // step 1 succeeded, Keycloak and the DB are now out of sync — surface
      // that clearly rather than leaving it silent (same pattern as user
      // creation, since there's no automatic rollback here either).
      try {
        await userManagementService.updateUser(u.user_id, u.username, customer.customer_id, nextActive, token);
      } catch (err) {
        setToast({
          message: `Keycloak was updated but the database record failed (${
            err instanceof Error ? err.message : "unknown error"
          }). "${u.username}" is now out of sync between Keycloak and the database.`,
          type: "error",
        });
        return;
      }

      setUsers((prev) =>
        prev.map((row) => (row.user_id === u.user_id ? { ...row, is_active: nextActive } : row))
      );
      setToast({
        message: `User "${u.username}" ${nextActive === 1 ? "enabled" : "disabled"} successfully${
          u.keycloak_id ? "" : " (no linked Keycloak account — local only)"
        }`,
        type: "success",
      });
    } finally {
      setTogglingUserId(null);
    }
  };

  const copyPassword = async () => {
    try {
      await navigator.clipboard.writeText(resetPassword);
      setResetCopied(true);
    } catch {
      // Clipboard access is refused on a plain http page and in some
      // browsers. The password is on screen either way, so say so rather
      // than leaving a button that appears to do nothing.
      setToast({ message: "Could not copy — select the password and copy it by hand.", type: "info" });
    }
  };

  const doReset = async () => {
    const keycloakId = resetFor?.keycloak_id ?? detailsFor(resetFor!)?.id;
    if (!resetFor || !keycloakId || resetPassword.length < 8) return;

    setResetting(true);
    try {
      const token = await authService.ensureValidToken();
      await userManagementService.setPassword(keycloakId, resetPassword, token);
      setToast({
        message: `Password set. ${resetFor.username} must choose their own at the next sign-in.`,
        type: "success",
      });
      setResetFor(null);
      setResetPassword("");
      setResetCopied(false);
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : "Failed to set the password",
        type: "error",
      });
    } finally {
      setResetting(false);
    }
  };

  const openEdit = (u: AppUser) => {
    setSelectedUser(u);
    setEditUsername(u.username);
    setEditCustomerRoleId(u.role_id ? String(u.role_id) : "");
    setIsEditOpen(true);
  };



  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customer) return;

    // An email address is what makes the account reachable now: the link
    // that sets its password goes there. Without one there is nothing to
    // send and no way to hand the account over.
    // Email is what makes the account reachable: the link that sets its
    // password goes there. The names are required because they are what
    // everyone else sees — a comment author, a forward's sender, this list —
    // and because `auth_api`'s /update_profile already refuses to clear
    // them, so an account could be created in a state its owner could not
    // save.
    if (
      !newUser.username.trim() ||
      !newUser.email.trim() ||
      !newUser.firstName.trim() ||
      !newUser.lastName.trim()
    ) {
      setToast({ message: "Username, email and name are required", type: "error" });
      return;
    }

    setCreatingUser(true);

    const token = await authService.ensureValidToken();

    // Step 1: create the identity in Keycloak (via auth_api), using the
    // calling admin's own token — /add_user requires the caller to carry
    // manage-users/realm-admin, there's no privileged service-account path.
    let keycloakUser;
    try {
      keycloakUser = await userManagementService.createKeycloakUser(newUser, token);
    } catch (err) {
      setToast({
        message: `Failed to create user in Keycloak: ${err instanceof Error ? err.message : "Unknown error"}`,
        type: "error",
      });
      setCreatingUser(false);
      return;
    }

    // Step 2: create the matching record in smartdoc_api's DB — username as
    // supplied, plus the Keycloak sub in the dedicated keycloak_id column.
    // If this fails, the Keycloak account already exists (auth_api has no
    // delete endpoint to roll it back) — surface that clearly rather than
    // leaving it silent.
    try {
      await userManagementService.createDbUser(
        keycloakUser.username,
        keycloakUser.id,
        customer.customer_id,
        token
      );
    } catch (err) {
      setToast({
        message: `User "${keycloakUser.username}" was created in Keycloak but the database record failed (${
          err instanceof Error ? err.message : "unknown error"
        }). This user cannot log in yet — contact an administrator before retrying.`,
        type: "error",
      });
      setCreatingUser(false);
      return;
    }

    // Say whether the verification email went out. Silence here would leave
    // an administrator thinking the person has a link when they do not, and
    // that person cannot sign in until they follow one.
    setToast(
      keycloakUser.verification === "failed"
        ? {
            message: `User "${keycloakUser.username}" was created, but the verification email could not be sent. Use the envelope beside their name to try again.`,
            type: "error",
          }
        : {
            message: `User "${keycloakUser.username}" created. A link to verify their email is on its way.`,
            type: "success",
          }
    );
    setIsAddUserOpen(false);
    setNewUser(emptyNewUser);
    setCreatingUser(false);
    loadAll(keycloakUser.username);
  };

  const handleEditUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser || !customer || !editUsername.trim()) return;

    setSavingEdit(true);
    try {
      const token = await authService.ensureValidToken();
      await userManagementService.updateUser(
        selectedUser.user_id,
        editUsername.trim(),
        customer.customer_id,
        selectedUser.is_active,
        token,
        editCustomerRoleId ? Number(editCustomerRoleId) : null
      );
      setToast({ message: "User updated successfully", type: "success" });
      setIsEditOpen(false);
      loadAll();
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : "Failed to update user",
        type: "error",
      });
    } finally {
      setSavingEdit(false);
    }
  };




  return (
    <div className="flex flex-col flex-1 w-full bg-gray-50 dark:bg-gray-900 overflow-hidden min-w-0 min-h-0">
      <PageMeta title="Users | SmartDoc" description="The people who work on this customer" />

      {/* Header */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-2.5 min-w-0 flex-shrink-0 overflow-hidden w-full">
        <div className="flex items-center justify-between gap-4 w-full">
          <div className="relative w-full max-w-xs">
            <span className="absolute -translate-y-1/2 pointer-events-none left-3 top-1/2">
              <svg
                className="fill-gray-500 dark:fill-gray-400"
                width="16"
                height="16"
                viewBox="0 0 20 20"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M3.04175 9.37363C3.04175 5.87693 5.87711 3.04199 9.37508 3.04199C12.8731 3.04199 15.7084 5.87693 15.7084 9.37363C15.7084 12.8703 12.8731 15.7053 9.37508 15.7053C5.87711 15.7053 3.04175 12.8703 3.04175 9.37363ZM9.37508 1.54199C5.04902 1.54199 1.54175 5.04817 1.54175 9.37363C1.54175 13.6991 5.04902 17.2053 9.37508 17.2053C11.2674 17.2053 13.003 16.5344 14.357 15.4176L17.177 18.238C17.4699 18.5309 17.9448 18.5309 18.2377 18.238C18.5306 17.9451 18.5306 17.4703 18.2377 17.1774L15.418 14.3573C16.5365 13.0033 17.2084 11.2669 17.2084 9.37363C17.2084 5.04817 13.7011 1.54199 9.37508 1.54199Z"
                  fill=""
                />
              </svg>
            </span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search users..."
              className="h-9 w-full rounded-lg border border-gray-200 bg-transparent py-2 pl-9 pr-3 text-sm text-gray-800 shadow-theme-xs placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30 dark:focus:border-brand-800"
            />
          </div>
          <Button
            size="xs"
            onClick={() => {
              // Cleared on the way in, not on the way out: a failed attempt
              // keeps what was typed so the username can be corrected, but
              // opening the dialog again starts from nothing rather than
              // showing somebody last week's half-filled form.
              setNewUser(emptyNewUser);
              setIsAddUserOpen(true);
            }}
            startIcon={
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="size-4"
              >
                <circle cx="10" cy="8.5" r="3.5" />
                <path d="M3.5 19.5a6.5 6.5 0 0 1 11.2-4.5" />
                <path d="M18 14v6M15 17h6" />
              </svg>
            }
          >
            Add New User
          </Button>
        </div>
        {error && <Toast message={error} type="error" onClose={() => setError(null)} />}
        {detailsUnavailable && (
          <p className="mt-2 text-xs text-warning-500">
            Names and emails can't be shown — your account needs Keycloak's "view-users" permission.
            Everything else on this screen works.
          </p>
        )}
      </div>

      {/* Body */}
      <div
        className={`grid flex-1 grid-cols-1 overflow-hidden min-w-0 min-h-0 ${
          // The projects list is two columns of short text; the users
          // table is four and carries the actions. A quarter of the screen
          // is enough for the one and leaves the other room to fit.
          manageProjects ? "lg:grid-cols-[minmax(0,1fr)_22rem]" : ""
        }`}
      >
        {/* Users */}
        <div className="bg-white dark:bg-gray-800 border-t lg:border-r border-gray-200 dark:border-gray-700 overflow-auto min-w-0">
          <Table>
            <TableHeader className="border-b border-gray-100 dark:border-gray-800">
              <TableRow>
                <TableCell isHeader className="whitespace-nowrap px-3 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                  User
                </TableCell>
                <TableCell isHeader className="whitespace-nowrap px-3 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                  Email
                </TableCell>
                <TableCell isHeader className="whitespace-nowrap px-3 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                  Created
                </TableCell>
                <TableCell isHeader className="whitespace-nowrap px-3 py-2.5 text-right text-xs font-medium text-gray-500 dark:text-gray-400">
                  Actions
                </TableCell>
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-gray-100 dark:divide-gray-800">
              {loadingUsers ? (
                <TableRow>
                  <TableCell className="whitespace-nowrap px-4 py-3 text-sm text-gray-500 dark:text-gray-400" colSpan={6}>
                    Loading users...
                  </TableCell>
                </TableRow>
              ) : filteredUsers.length === 0 ? (
                <TableRow>
                  <TableCell className="whitespace-nowrap px-4 py-3 text-sm text-gray-500 dark:text-gray-400" colSpan={6}>
                    {users.length === 0 ? "No users found" : "No users match your search"}
                  </TableCell>
                </TableRow>
              ) : (
                filteredUsers.map((u) => {
                  const isEnabled = u.is_active === 1;
                  const isSelected = selectedUser?.user_id === u.user_id;
                  return (
                    <TableRow
                      key={u.user_id}
                      onClick={() => setSelectedUser(u)}
                      className={`cursor-pointer ${
                        isSelected
                          ? "bg-brand-50 dark:bg-brand-500/10"
                          : "hover:bg-gray-50 dark:hover:bg-white/[0.03]"
                      }`}
                    >
                      {/* The username with the real name under it, and the
                          cAdmin mark beside it. Four columns instead of
                          six: the pane is two fifths of the screen, and six
                          columns of nowrap text put a scrollbar under the
                          whole table. */}
                      <TableCell className="px-3 py-2 text-sm">
                        <span className="flex items-center gap-2">
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-gray-800 dark:text-white/90">
                              {u.username}
                            </span>
                            {fullName(u) && (
                              <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
                                {fullName(u)}
                              </span>
                            )}
                          </span>
                          {Number(u.role_id) === CUSTOMER_ADMIN_ROLE && (
                            <span
                              title="Runs this customer"
                              className="flex-shrink-0 rounded-full border border-brand-500/40 bg-brand-500/10 px-1.5 py-0.5 text-[10px] font-medium text-brand-500"
                            >
                              cAdmin
                            </span>
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300">
                        <span className="flex items-center gap-1.5">
                          <span title={detailsFor(u)?.email} className="block max-w-[13rem] truncate">
                            {detailsFor(u)?.email || "—"}
                          </span>
                          {/* Keycloak's own flag. An address nobody has
                              confirmed is where a password reset or a
                              notice would go astray, so it is worth a mark
                              beside the address rather than a column. */}
                          {detailsFor(u)?.email && detailsFor(u)?.emailVerified === false && (
                            // The mark is the button: an administrator who
                            // notices it is usually about to ask for the
                            // link to be sent again, and a separate icon
                            // would be a second small target for the same
                            // thought.
                            <button
                              type="button"
                              disabled={resendingFor === u.username}
                              title="Email not verified — click to send the link again"
                              onClick={async () => {
                                setResendingFor(u.username);
                                try {
                                  await authService.resendVerification(u.username);
                                  setToast({
                                    message: `Verification link sent to ${detailsFor(u)?.email}.`,
                                    type: "success",
                                  });
                                } catch (err) {
                                  setToast({
                                    message: err instanceof Error ? err.message : "Could not send the email",
                                    type: "error",
                                  });
                                } finally {
                                  setResendingFor(null);
                                }
                              }}
                              className="rounded-full border border-warning-500/40 bg-warning-500/10 px-1.5 py-0.5 text-[10px] font-medium text-warning-600 transition hover:bg-warning-500/20 disabled:opacity-60"
                            >
                              {resendingFor === u.username ? "Sending..." : "Not verified"}
                            </button>
                          )}
                        </span>
                      </TableCell>
                      {/* Keycloak's date: the account is made there, and the
                          app's own row records none. Blank when names and
                          emails are unavailable, for the same reason. */}
                      <TableCell className="whitespace-nowrap px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                        {detailsFor(u)?.createdTimestamp
                          ? new Date(detailsFor(u)!.createdTimestamp!).toLocaleDateString()
                          : "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap px-3 py-2 text-sm">
                        <div className="flex items-center justify-end gap-1">
                          {/* A switch, not a tick: this is a setting with two
                              states, and the tick read as "verified" rather
                              than "can sign in". */}
                          <button
                            type="button"
                            role="switch"
                            aria-checked={isEnabled}
                            title={isEnabled ? "Can sign in — click to disable" : "Cannot sign in — click to enable"}
                            disabled={togglingUserId === u.user_id}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleActive(u);
                            }}
                            className={`flex h-5 w-9 flex-shrink-0 items-center rounded-full p-0.5 transition-colors disabled:opacity-50 ${
                              isEnabled ? "bg-success-500" : "bg-gray-300 dark:bg-gray-600"
                            }`}
                          >
                            {togglingUserId === u.user_id ? (
                              <span className="mx-auto block size-3 rounded-full border-2 border-white border-t-transparent animate-spin" />
                            ) : (
                              <span
                                className={`block size-4 rounded-full bg-white shadow-theme-xs transition-transform ${
                                  isEnabled ? "translate-x-4" : ""
                                }`}
                              />
                            )}
                          </button>
                          <button
                            type="button"
                            title="Set a new password"
                            onClick={(e) => {
                              e.stopPropagation();
                              setResetFor(u);
                              setResetPassword(generatePassword(Math.max(14, passwordRules.minLength)));
                              setResetCopied(false);
                            }}
                            className="p-1.5 rounded text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/[0.05]"
                          >
                            {/* A lock: this is the way back in for somebody
                                shut out, not a change to who they are. */}
                            <LockIcon className="size-4" />
                          </button>
                          <button
                            type="button"
                            title="Edit user"
                            onClick={(e) => {
                              e.stopPropagation();
                              openEdit(u);
                            }}
                            className="p-1.5 rounded text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/[0.05]"
                          >
                            <PencilIcon className="size-4" />
                          </button>
                          {manageProjects && (
                            <button
                              type="button"
                              title="Projects and privileges"
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/${customerUrl}/users/${u.user_id}/access`);
                              }}
                              className="p-1.5 rounded text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/[0.05]"
                            >
                              {/* A key: this screen is about what they may
                                  do, not about storing anything. A folder
                                  read as "their documents", which is the
                                  one thing it is not. */}
                              <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="size-4"
                              >
                                <circle cx="8" cy="15" r="3.5" />
                                <path d="m10.5 12.5 7.5-7.5" />
                                <path d="m15.5 7.5 2 2" />
                                <path d="m18 5 2 2" />
                              </svg>
                            </button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Selected user's projects — the customer's own business, so not
            shown to whoever runs SmartDoc. */}
        {manageProjects && (
        <div className="bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 overflow-auto min-w-0">
          <Table>
            <TableHeader className="border-b border-gray-100 dark:border-gray-800">
              <TableRow>
                <TableCell isHeader className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                  Project Name
                </TableCell>
                <TableCell isHeader className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                  Role
                </TableCell>

              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-gray-100 dark:divide-gray-800">
              {!selectedUser ? (
                <TableRow>
                  <TableCell className="px-4 py-4 text-sm text-gray-500 dark:text-gray-400" colSpan={2}>
                    Select a user to see their projects
                  </TableCell>
                </TableRow>
              ) : selectedUserProjects.length === 0 ? (
                <TableRow>
                  <TableCell className="px-4 py-4 text-sm text-gray-500 dark:text-gray-400" colSpan={2}>
                    No projects assigned
                  </TableCell>
                </TableRow>
              ) : (
                selectedUserProjects.map((up) => (
                  <TableRow key={up.user_project_id}>
                    <TableCell className="px-4 py-4 text-sm text-gray-800 dark:text-white/90">
                      {projectNameById.get(String(up.project_id)) || "Unknown project"}
                    </TableCell>
                    <TableCell className="px-4 py-4 text-sm text-gray-700 dark:text-gray-300">
                      <span className="flex items-center gap-2">
                        {up.role_id === Role.ADMIN
                          ? "Admin"
                          : up.role_id === Role.VIEWER
                            ? "Viewer"
                            : "Worker"}

                        {/* What a viewer may add, beside the word. "Viewer"
                            alone says nothing about whether they can comment
                            or send a page on, which is the thing somebody
                            came to this panel to check. Only for a viewer:
                            an admin has all three and a worker does not open
                            the reading app. */}
                        {up.role_id === Role.VIEWER && (
                          <span className="flex items-center gap-0.5">
                            {PRIVILEGE_MARKS.map(({ field, label, path }) => {
                              const on = (up[field] ?? 1) === 1;
                              return (
                                <span
                                  key={field}
                                  title={`${label}: ${on ? "yes" : "no"}`}
                                  className={
                                    on
                                      ? "text-brand-500"
                                      : "text-gray-400 line-through decoration-gray-400 dark:text-gray-500"
                                  }
                                >
                                  <svg
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.9"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    className="size-3.5"
                                  >
                                    <path d={path} />
                                  </svg>
                                </span>
                              );
                            })}
                          </span>
                        )}
                      </span>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        )}
      </div>

      
      {/* Add New User modal */}
      <Modal isOpen={isAddUserOpen} onClose={() => setIsAddUserOpen(false)} className="max-w-md p-6">
        <h3 className="mb-5 text-lg font-semibold text-gray-800 dark:text-white/90">Add New User</h3>
        <form onSubmit={handleAddUser} className="space-y-4">
          <div>
            <Label htmlFor="username">Username *</Label>
            <Input
              id="username"
              value={newUser.username}
              onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="email">Email *</Label>
            <Input
              id="email"
              type="email"
              value={newUser.email}
              onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="firstName">First Name *</Label>
              <Input
                id="firstName"
                value={newUser.firstName}
                onChange={(e) => setNewUser({ ...newUser, firstName: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="lastName">Last Name *</Label>
              <Input
                id="lastName"
                value={newUser.lastName}
                onChange={(e) => setNewUser({ ...newUser, lastName: e.target.value })}
              />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button
              size="xs"
              type="button"
              variant="outline"
              onClick={() => setIsAddUserOpen(false)}
              disabled={creatingUser}
            >
              Cancel
            </Button>
            <Button size="xs" type="submit" disabled={creatingUser}>
              {creatingUser ? "Creating..." : "Create User"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Edit user modal */}
      <Modal isOpen={isEditOpen} onClose={() => setIsEditOpen(false)} className="max-w-md p-6">
        <h3 className="mb-5 text-lg font-semibold text-gray-800 dark:text-white/90">
          Edit User: {selectedUser?.username}
        </h3>
        <form onSubmit={handleEditUser} className="space-y-4">
          <div>
            <Label htmlFor="edit-username">Username *</Label>
            <Input
              id="edit-username"
              value={editUsername}
              onChange={(e) => setEditUsername(e.target.value)}
            />
          </div>

          {/* What this person may do across the whole customer. Their role on
              each project is a separate thing, set where the projects are.
              A switch rather than a list: there is one such role, and it is
              either on or off. */}
          <div className="flex items-center justify-between gap-4 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
            <span>
              <span className="block text-sm font-medium text-gray-800 dark:text-white/90">
                Customer Administrator
              </span>
              <span className="block text-xs text-gray-500 dark:text-gray-400">
                Sets up projects, storage, users and branding for the whole customer, with no
                project open. Project roles are separate.
              </span>
            </span>

            <button
              type="button"
              role="switch"
              aria-checked={editCustomerRoleId === String(CUSTOMER_ADMIN_ROLE)}
              onClick={() =>
                setEditCustomerRoleId((current) =>
                  current === String(CUSTOMER_ADMIN_ROLE) ? "" : String(CUSTOMER_ADMIN_ROLE),
                )
              }
              className={`flex h-5 w-9 flex-shrink-0 items-center rounded-full p-0.5 transition-colors ${
                editCustomerRoleId === String(CUSTOMER_ADMIN_ROLE)
                  ? "bg-brand-500"
                  : "bg-gray-300 dark:bg-gray-600"
              }`}
            >
              <span
                className={`block size-4 rounded-full bg-white shadow-theme-xs transition-transform ${
                  editCustomerRoleId === String(CUSTOMER_ADMIN_ROLE) ? "translate-x-4" : ""
                }`}
              />
            </button>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button
              size="xs"
              type="button"
              variant="outline"
              onClick={() => setIsEditOpen(false)}
              disabled={savingEdit}
            >
              Cancel
            </Button>
            <Button size="xs" type="submit" disabled={savingEdit}>
              {savingEdit ? "Saving..." : "Save"}
            </Button>
          </div>
        </form>
      </Modal>

      
      {/* Enable/disable confirmation dialog */}
      <Modal isOpen={!!pendingToggle} onClose={() => setPendingToggle(null)} className="max-w-sm p-6">
        <h3 className="mb-2 text-lg font-semibold text-gray-800 dark:text-white/90">
          {pendingToggle?.nextActive === 0 ? "Disable user?" : "Enable user?"}
        </h3>
        <p className="mb-5 text-sm text-gray-500 dark:text-gray-400">
          {pendingToggle?.nextActive === 0
            ? `"${pendingToggle?.user.username}" will no longer be able to log in.`
            : `"${pendingToggle?.user.username}" will be able to log in again.`}
        </p>
        <div className="flex justify-end gap-3">
          <Button size="xs" type="button" variant="outline" onClick={() => setPendingToggle(null)}>
            Cancel
          </Button>
          <Button size="xs" type="button" onClick={confirmToggleActive}>
            {pendingToggle?.nextActive === 0 ? "Disable" : "Enable"}
          </Button>
        </div>
      </Modal>

      
      {/* The password is made here rather than thought up: one less thing to
          decide, and it will not be somebody's usual password. It is
          temporary in Keycloak's sense — whoever receives it is asked to
          choose their own before they get in, so it only has to survive
          being passed on once. */}
      {resetFor && (
        <Modal isOpen onClose={() => setResetFor(null)} className="max-w-lg p-8">
          <h3 className="mb-2 pr-10 text-lg font-semibold text-gray-800 dark:text-white/90">
            User: {resetFor.username}
          </h3>
          <p className="mb-5 text-sm text-gray-500 dark:text-gray-400">
            Generate a one-time temporary password for {resetFor.username}. They choose
            their own at the next sign-in — {passwordRulesText.toLowerCase()}
          </p>

          <Label htmlFor="reset-password">Temporary password</Label>
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
            <Input
              id="reset-password"
              type="text"
              value={resetPassword}
              onChange={(e) => {
                setResetPassword(e.target.value);
                setResetCopied(false);
              }}
              placeholder="At least 8 characters"
              compact
              className="font-mono tracking-wide"
            />
            </div>
            {/* The same 36px as the compact field beside it. */}
            <Button size="xs" type="button" variant="outline" className="h-9" onClick={copyPassword}>
              {resetCopied ? "Copied" : "Copy"}
            </Button>
          </div>
          <button
            type="button"
            onClick={() => {
              setResetPassword(generatePassword(Math.max(14, passwordRules.minLength)));
              setResetCopied(false);
            }}
            className="mt-2 text-sm text-brand-500 hover:text-brand-600"
          >
            Generate another
          </button>

          <div className="mt-5 flex justify-end gap-3">
            <Button size="xs" type="button" variant="outline" onClick={() => setResetFor(null)}>
              Cancel
            </Button>
            <Button
              size="xs"
              type="button"
              disabled={resetting || resetPassword.length < 8}
              onClick={doReset}
            >
              {resetting ? "Setting..." : "Set password"}
            </Button>
          </div>
        </Modal>
      )}

      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} position="top-center" />
      )}
    </div>
  );
}
