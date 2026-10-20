import { UserProject } from "./authService";
import { cached, forget, FOREVER } from "./cache";

const API_URL = import.meta.env.VITE_API_URL;
const AUTH_API_URL = import.meta.env.VITE_AUTH_API_URL;

export interface AppUser {
  user_id: number;
  username: string;
  customer_id: number;
  keycloak_id: string | null;
  is_active: 0 | 1;
  // What this person may do across the whole customer — 3 is customer
  // administrator, null an ordinary user whose rights come from their
  // projects. See CustomerRole in smartdoc_api/enums.js.
  role_id: number | null;
}

// Customer-level roles. Project roles (1 admin, 2 worker) live on
// user_project and answer a different question — see
// smartdoc_context/domain-model.md.
export const CUSTOMER_ADMIN_ROLE = 3;

export interface Project {
  project_id: number;
  project_name: string;
  customer_id: number;
  identifier_label: string;
  is_active: 0 | 1;
  // Not on the row yet — planned. The project chooser shows them when
  // present and nothing when not, so adding the columns needs no UI change.
  project_description?: string | null;
  project_type?: string | null;
}

export interface KeycloakUser {
  id: string;
  username: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  enabled: boolean;
  emailVerified: boolean;
  // Present only on creation: whether the verification email went out.
  verification?: "sent" | "failed";
  // When the account was made, in milliseconds. Keycloak's, because the
  // app's own `user` table records no date — and the account is created
  // there first.
  createdTimestamp?: number;
}

export interface NewUserInput {
  username: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  password: string;
}

const jsonHeaders = (accessToken: string) => ({
  "Authorization": `Bearer ${accessToken}`,
  "Content-Type": "application/json",
});

const extractMessage = async (response: Response, fallback: string) => {
  try {
    const body = await response.json();
    return body?.message || fallback;
  } catch {
    return fallback;
  }
};

/**
 * Four reads every setup screen repeats, held for this tab.
 *
 * Ten screens call `getProjectsByCustomer`, and each one fetched it again:
 * the Users screen alone cost `/user/customer/:id`, `/project/customer/:id`,
 * `/user_project/customer/:id` and the whole of Keycloak, then paid for all
 * four again on the way back from User Access. 208 requests and 1.2 MB for a
 * few screens, mostly the same lists twice.
 *
 * `FOREVER` means until sign-out or until something here writes. These are
 * setup lists — the people, the projects, who is on what. They change when
 * somebody on this screen changes them, which is exactly when a write below
 * forgets them.
 *
 * **Every write clears what it touched**, in the service and never in the
 * screen that called it, so a new caller cannot forget to. The one that is
 * easy to miss is Keycloak's copy: creating a person and enabling or
 * disabling one both change it, and neither looks like it would.
 */
const KEY = {
  users: (customerId: number) => `users:${customerId}`,
  projects: (customerId: number) => `projects:${customerId}`,
  memberships: (customerId: number) => `memberships:${customerId}`,
  keycloak: "keycloak-users",
};

/** What changed about people: the app's rows and Keycloak's copy of them. */
const forgetPeople = () => {
  forget("users");
  forget(KEY.keycloak);
};

export const userManagementService = {
  async getUsersByCustomer(customerId: number, accessToken: string): Promise<AppUser[]> {
    return cached(KEY.users(customerId), FOREVER, async () => {
      const response = await fetch(`${API_URL}/user/customer/${customerId}`, {
        method: "GET",
        headers: jsonHeaders(accessToken),
      });

      if (!response.ok) {
        throw new Error(await extractMessage(response, "Failed to fetch users"));
      }

      const body = await response.json();
      return (body.data || []) as AppUser[];
    });
  },

  async getProjectsByCustomer(customerId: number, accessToken: string): Promise<Project[]> {
    return cached(KEY.projects(customerId), FOREVER, async () => {
      const response = await fetch(`${API_URL}/project/customer/${customerId}`, {
        method: "GET",
        headers: jsonHeaders(accessToken),
      });

      if (!response.ok) {
        throw new Error(await extractMessage(response, "Failed to fetch projects"));
      }

      const body = await response.json();
      return (body.data || []) as Project[];
    });
  },

  /**
   * Set somebody's password, for when they have forgotten it and there is
   * nobody inside their customer who can help — a customer administrator,
   * usually, since they are the top of their own ladder.
   *
   * Temporary: Keycloak makes them choose their own at the next sign-in, so
   * the one that was read down a phone stops working once it has been used.
   *
   * **Through smartdoc_api, not auth_api** (2026-10-18). Sent to auth_api
   * with the administrator's own token, Keycloak judged them and refused
   * every customer administrator (bug #31). smartdoc_api decides on
   * SmartDoc's roles and asks auth_api as itself, as creating a user does.
   */
  async setPassword(userId: number, password: string, accessToken: string): Promise<void> {
    const response = await fetch(`${API_URL}/user/${userId}/temporary_password`, {
      method: "POST",
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ password }),
    });

    if (!response.ok) {
      // The customer's password rules, or Keycloak's own policy, answer
      // here — "invalid password: minimum length" — which is what somebody
      // needs to read.
      throw new Error(await extractMessage(response, "Failed to set the password"));
    }
  },

  // Keycloak's copy of a user: email and real name live there, not in the
  // app's `user` table, which holds only username / customer / status.
  //
  // Uses the caller's own token — auth_api has no privileged service account
  // for this — so an admin without `view-users` gets a 403. The screen treats
  // that as "names unavailable" rather than a failure, since usernames and
  // project assignments still work without it.
  async getKeycloakUsers(accessToken: string, max = 500): Promise<KeycloakUser[]> {
    // The heaviest of the four — every account in the realm, up to 500 — and
    // the one that was fetched most often. Held per tab; the writes that
    // change it (creating a person, enabling or disabling one) clear it.
    return cached(KEY.keycloak, FOREVER, async () => {
      const response = await fetch(`${AUTH_API_URL}/all_users?max=${max}`, {
        method: "POST",
        headers: jsonHeaders(accessToken),
      });

      if (!response.ok) {
        throw new Error(await extractMessage(response, "Failed to fetch user details"));
      }

      const body = await response.json();
      return (body.data?.users || []) as KeycloakUser[];
    });
  },

  /**
   * Every membership inside one customer.
   *
   * There is deliberately no "all memberships" call here. This asked
   * `GET /user_project/` — every row in the system — and the screen kept the
   * ones whose user it recognised, which meant one company's memberships
   * arrived in another company's browser and sat in the network tab. The
   * server now does the narrowing and refuses a customer that is not yours.
   */
  async getUserProjectsByCustomer(customerId: number, accessToken: string): Promise<UserProject[]> {
    return cached(KEY.memberships(customerId), FOREVER, async () => {
      const response = await fetch(`${API_URL}/user_project/customer/${customerId}`, {
        method: "GET",
        headers: jsonHeaders(accessToken),
      });

      if (!response.ok) {
        throw new Error(await extractMessage(response, "Failed to fetch user projects"));
      }

      const body = await response.json();
      return (body.data || []) as UserProject[];
    });
  },

  /**
   * Who is on one project, with their role there. What New Assignment and
   * Hand over offer is drawn from this: a batch can only go to somebody who
   * works on the project.
   */
  async getProjectMembers(projectId: number, accessToken: string): Promise<UserProject[]> {
    const response = await fetch(`${API_URL}/user_project/project/${projectId}`, {
      method: "GET",
      headers: jsonHeaders(accessToken),
    });

    if (!response.ok) {
      throw new Error(await extractMessage(response, "Failed to fetch the project's people"));
    }

    const body = await response.json();
    return (body.data || []) as UserProject[];
  },

  // roleId is the capacity the user gets on THIS project: 1 = admin,
  // 2 = worker. Single-valued per membership, so granting access and
  // choosing a role are the same action.
  async assignProject(
    userId: number,
    projectId: number,
    accessToken: string,
    roleId: number = 2
  ): Promise<UserProject> {
    const response = await fetch(`${API_URL}/user_project/`, {
      method: "POST",
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ user_id: userId, project_id: projectId, role_id: roleId }),
    });

    if (!response.ok) {
      throw new Error(await extractMessage(response, "Failed to assign project"));
    }

    forget("memberships");

    const body = await response.json();
    return body.data;
  },

  // A membership carries exactly one role, so changing someone's capacity on
  // a project is an update to that row rather than a separate grant.
  // PUT /user_project/ needs user_id and project_id as well — it writes the
  // whole row, so sending role_id alone would blank the other two.
  /**
   * The role on one project, and the three exceptions that go with it.
   *
   * Null on an exception means "use whatever the role gives"; only a
   * viewer's are ever read, since an administrator has all three however
   * these are set.
   */
  async updateProjectRole(
    userProjectId: number,
    userId: number,
    projectId: number,
    roleId: number,
    accessToken: string,
    // 1, 0 or null — null being "use whatever the role gives", the same
    // three values the column holds.
    allowed?: {
      can_comment?: number | null;
      can_annotate?: number | null;
      can_forward?: number | null;
    }
  ): Promise<UserProject> {
    const response = await fetch(`${API_URL}/user_project/`, {
      method: "PUT",
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({
        user_project_id: userProjectId,
        user_id: userId,
        project_id: projectId,
        role_id: roleId,
        ...(allowed ?? {}),
      }),
    });

    if (!response.ok) {
      throw new Error(await extractMessage(response, "Failed to change role"));
    }

    forget("memberships");

    const body = await response.json();
    return body.data?.data;
  },

  async removeProjectAssignment(userProjectId: number, accessToken: string): Promise<void> {
    const response = await fetch(`${API_URL}/user_project/${userProjectId}`, {
      method: "DELETE",
      headers: jsonHeaders(accessToken),
    });

    if (!response.ok) {
      throw new Error(await extractMessage(response, "Failed to remove project assignment"));
    }

    forget("memberships");
  },

  /**
   * Send somebody their invitation again — the "Not verified" mark.
   *
   * **SmartDoc's link, not Keycloak's verification mail.** That mail led to
   * a Keycloak page, which knows one password policy for the whole realm and
   * so could not apply this customer's rules. The link this sends lands on
   * `/:customerUrl/set-password`, which can.
   */
  async resendInvite(userId: number, accessToken: string): Promise<void> {
    const response = await fetch(`${API_URL}/user/${userId}/invite`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!response.ok) {
      throw new Error(await extractMessage(response, "Could not send the email"));
    }
  },

  /**
   * Create a person: the Keycloak account and the SmartDoc row, in one call.
   *
   * **Who may is decided by `smartdoc_api`**, on SmartDoc's own roles. It
   * used to be two calls, the first straight to `auth_api` with the admin's
   * own token — so Keycloak judged the person, and a customer administrator
   * without `manage-users` was refused. Two different ideas of
   * "administrator", and only one of them is on this screen.
   *
   * One call also closes the gap where the second failed and left a Keycloak
   * account with nothing pointing at it.
   */
  async provisionUser(
    input: {
      username: string;
      email: string;
      firstName: string;
      lastName: string;
      customerId: number;
      /** 3 makes them a customer administrator; omitted leaves them ordinary. */
      roleId?: number | null;
    },
    accessToken: string,
  ): Promise<{
    user_id: number;
    username: string;
    /**
     * Whether the invitation went out. **The account exists either way** —
     * a refused SMTP connection must not undo somebody's creation, so the
     * server reports it rather than throwing, and the screen offers to send
     * it again.
     */
    invited?: { sent: boolean; reason: string | null };
  }> {
    const response = await fetch(`${API_URL}/user/provision`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        username: input.username,
        email: input.email,
        firstName: input.firstName,
        lastName: input.lastName,
        customer_id: input.customerId,
        ...(input.roleId ? { role_id: input.roleId } : {}),
      }),
    });

    if (!response.ok) {
      throw new Error(await extractMessage(response, "Failed to create the user"));
    }

    // Both halves: this made a `user` row and a Keycloak account, and the
    // screen reads the name and email from the second.
    forgetPeople();

    const body = await response.json();
    return body.data;
  },

  /**
   * Switch somebody on or off: their sign-in account and their SmartDoc
   * record, in one call to smartdoc_api, which makes both changes.
   *
   * The screen used to make them itself — auth_api with the administrator's
   * own token, which Keycloak refused for every customer administrator
   * (bug #31), then the row — and a failure between the two left them
   * disagreeing.
   */
  async setUserActive(userId: number, enabled: boolean, accessToken: string): Promise<AppUser> {
    const response = await fetch(`${API_URL}/user/${userId}/status`, {
      method: "POST",
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ enabled }),
    });

    if (!response.ok) {
      throw new Error(await extractMessage(response, "Failed to change the account"));
    }

    // Both copies changed: the row's is_active and Keycloak's enabled flag.
    forgetPeople();
    const body = await response.json();
    return body.data;
  },

  async createProject(
    projectName: string,
    customerId: number,
    identifierLabel: string,
    accessToken: string
  ): Promise<Project> {
    const response = await fetch(`${API_URL}/project/`, {
      method: "POST",
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({
        project_name: projectName,
        customer_id: customerId,
        identifier_label: identifierLabel,
      }),
    });

    if (!response.ok) {
      throw new Error(await extractMessage(response, "Failed to create project"));
    }

    forget("projects");

    const body = await response.json();
    return body.data;
  },

  // PUT /project/ replaces project_name/customer_id/identifier_label/is_active
  // together (not a partial patch) — callers must pass the full current
  // record, not just the field being changed, same as PUT /user/ below.
  async updateProject(
    projectId: number,
    projectName: string,
    customerId: number,
    identifierLabel: string,
    isActive: 0 | 1,
    accessToken: string
  ): Promise<Project> {
    const response = await fetch(`${API_URL}/project/`, {
      method: "PUT",
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({
        project_id: projectId,
        project_name: projectName,
        customer_id: customerId,
        identifier_label: identifierLabel,
        is_active: isActive,
      }),
    });

    if (!response.ok) {
      throw new Error(await extractMessage(response, "Failed to update project"));
    }

    forget("projects");

    const body = await response.json();
    return body.data?.data;
  },

  // PUT /user/ replaces username/customer_id/is_active together (not a
  // partial patch) — callers must pass the full current record, not just
  // the field being changed, or the others get overwritten with undefined.
  async updateUser(
    userId: number,
    username: string,
    customerId: number,
    isActive: 0 | 1,
    accessToken: string,
    // Omitted leaves whatever customer role the user already has: the API
    // only writes this column when it is sent.
    roleId?: number | null
  ): Promise<AppUser> {
    const response = await fetch(`${API_URL}/user/`, {
      method: "PUT",
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({
        user_id: userId,
        username,
        customer_id: customerId,
        is_active: isActive,
        ...(roleId === undefined ? {} : { role_id: roleId }),
      }),
    });

    if (!response.ok) {
      throw new Error(await extractMessage(response, "Failed to update user"));
    }

    forget("users");

    const body = await response.json();
    return body.data?.data;
  },
};
