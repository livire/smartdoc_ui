import { UserProject } from "./authService";

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

export const userManagementService = {
  async getUsersByCustomer(customerId: number, accessToken: string): Promise<AppUser[]> {
    const response = await fetch(`${API_URL}/user/customer/${customerId}`, {
      method: "GET",
      headers: jsonHeaders(accessToken),
    });

    if (!response.ok) {
      throw new Error(await extractMessage(response, "Failed to fetch users"));
    }

    const body = await response.json();
    return body.data || [];
  },

  async getProjectsByCustomer(customerId: number, accessToken: string): Promise<Project[]> {
    const response = await fetch(`${API_URL}/project/customer/${customerId}`, {
      method: "GET",
      headers: jsonHeaders(accessToken),
    });

    if (!response.ok) {
      throw new Error(await extractMessage(response, "Failed to fetch projects"));
    }

    const body = await response.json();
    return body.data || [];
  },

  /**
   * Set somebody's password, for when they have forgotten it and there is
   * nobody inside their customer who can help — a customer administrator,
   * usually, since they are the top of their own ladder.
   *
   * Temporary: Keycloak makes them choose their own at the next sign-in, so
   * the one that was read down a phone stops working once it has been used.
   * Needs Keycloak's `manage-users` on the caller's own account, like
   * creating a user does.
   */
  async setPassword(
    keycloakId: string,
    password: string,
    accessToken: string,
  ): Promise<void> {
    const response = await fetch(`${AUTH_API_URL}/set_password`, {
      method: "POST",
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ user_id: keycloakId, password, temporary: true }),
    });

    if (!response.ok) {
      // Keycloak's own password policy answers here — "invalid password:
      // minimum length" — which is what somebody needs to read.
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
    const response = await fetch(`${AUTH_API_URL}/all_users?max=${max}`, {
      method: "POST",
      headers: jsonHeaders(accessToken),
    });

    if (!response.ok) {
      throw new Error(await extractMessage(response, "Failed to fetch user details"));
    }

    const body = await response.json();
    return body.data?.users || [];
  },

  // All user_project rows, system-wide — used to derive per-user project
  // counts/lists client-side in one call instead of one call per user.
  async getAllUserProjects(accessToken: string): Promise<UserProject[]> {
    const response = await fetch(`${API_URL}/user_project/`, {
      method: "GET",
      headers: jsonHeaders(accessToken),
    });

    if (!response.ok) {
      throw new Error(await extractMessage(response, "Failed to fetch user projects"));
    }

    const body = await response.json();
    return body.data || [];
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

    const body = await response.json();
    return body.data;
  },

  // A membership carries exactly one role, so changing someone's capacity on
  // a project is an update to that row rather than a separate grant.
  // PUT /user_project/ needs user_id and project_id as well — it writes the
  // whole row, so sending role_id alone would blank the other two.
  async updateProjectRole(
    userProjectId: number,
    userId: number,
    projectId: number,
    roleId: number,
    accessToken: string
  ): Promise<UserProject> {
    const response = await fetch(`${API_URL}/user_project/`, {
      method: "PUT",
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({
        user_project_id: userProjectId,
        user_id: userId,
        project_id: projectId,
        role_id: roleId,
      }),
    });

    if (!response.ok) {
      throw new Error(await extractMessage(response, "Failed to change role"));
    }

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
  },

  // Step 1 of user creation: create the identity in Keycloak via auth_api.
  // Uses the calling admin's own token — /add_user has no privileged
  // service-account path, so the caller must carry manage-users/realm-admin.
  async createKeycloakUser(input: NewUserInput, accessToken: string): Promise<KeycloakUser> {
    const response = await fetch(`${AUTH_API_URL}/add_user`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        username: input.username,
        email: input.email,
        firstName: input.firstName,
        lastName: input.lastName,
        password: input.password,
        enabled: true,
        emailVerified: false,
      }),
    });

    if (!response.ok) {
      throw new Error(await extractMessage(response, "Failed to create user in Keycloak"));
    }

    const body = await response.json();
    return body.data;
  },

  // Step 2 of user creation: create the matching row in smartdoc_api's DB.
  // `username` is the plain supplied username; `keycloakId` is the Keycloak
  // `sub`/user id returned by createKeycloakUser, stored in the dedicated
  // `keycloak_id` column.
  async createDbUser(
    username: string,
    keycloakId: string,
    customerId: number,
    accessToken: string
  ): Promise<AppUser> {
    const response = await fetch(`${API_URL}/user/`, {
      method: "POST",
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ username, keycloak_id: keycloakId, customer_id: customerId }),
    });

    if (!response.ok) {
      throw new Error(await extractMessage(response, "Failed to create user record"));
    }

    const body = await response.json();
    return body.data;
  },

  // Sync the enable/disable state to Keycloak. Uses the calling admin's own
  // token — /user_status has no privileged service-account path, same as
  // /add_user, so the caller must carry manage-users/realm-admin.
  async setKeycloakUserStatus(
    keycloakUserId: string,
    enabled: boolean,
    accessToken: string
  ): Promise<void> {
    const response = await fetch(`${AUTH_API_URL}/user_status`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ user_id: keycloakUserId, enabled }),
    });

    if (!response.ok) {
      throw new Error(await extractMessage(response, "Failed to update Keycloak user status"));
    }
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

    const body = await response.json();
    return body.data?.data;
  },
};
