import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useAuth } from "./AuthContext";
import { useProject } from "./ProjectContext";
import { authService } from "../services/authService";

const API_URL = import.meta.env.VITE_API_URL;

// Roles are project-scoped and single-valued per membership. Admin is a
// superset of worker plus project setup — see
// ../../smartdoc_context/verification-redesign.md §6.
export const Role = {
  ADMIN: 1,
  WORKER: 2,
  // Reads finished documents in the viewer app. Captures nothing, verifies
  // nothing, is never handed a batch. 3 is skipped: it is 'cadmin', which
  // lives on user.role_id rather than user_project.role_id.
  VIEWER: 4,
} as const;

// What somebody may do across the whole customer, which no project can
// answer: a customer administrator need not be a member of any project.
export interface Account {
  user_id: number | null;
  customer_id: number | null;
  role_id: number | null;
  // True for a system administrator too: they can do everything a customer
  // administrator can, on any customer.
  is_customer_admin: boolean;
  is_sysadmin: boolean;
}

const NO_ACCOUNT: Account = {
  user_id: null,
  customer_id: null,
  role_id: null,
  is_customer_admin: false,
  is_sysadmin: false,
};

export interface Membership {
  is_member: boolean;
  user_project_id?: number;
  role_id: number | null;
  can_setup: boolean;
  can_capture: boolean;
  can_verify: boolean;
}

// Deny-by-default. Used before the answer arrives and if the request fails,
// so a hiccup hides controls rather than offering ones the server will refuse.
const NO_ACCESS: Membership = {
  is_member: false,
  role_id: null,
  can_setup: false,
  can_capture: false,
  can_verify: false,
};

interface MembershipContextValue {
  membership: Membership;
  account: Account;
  loading: boolean;
  // The customer-level answer arrives without a project, so it is worth
  // knowing separately: the sidebar has to wait for it before deciding what
  // a customer administrator with no project may see.
  accountLoading: boolean;
}

const MembershipContext = createContext<MembershipContextValue>({
  membership: NO_ACCESS,
  account: NO_ACCOUNT,
  loading: true,
  accountLoading: true,
});

/**
 * What the signed-in user may do on the currently selected project.
 *
 * This is for hiding controls the server would refuse anyway — it is not a
 * security boundary. Every rule it reports is enforced server-side too; a
 * user who forges this response still gets a 403 from the API.
 */
export function MembershipProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { project } = useProject();
  const [membership, setMembership] = useState<Membership>(NO_ACCESS);
  const [loading, setLoading] = useState(true);
  // What the browser already knows, so the first render is right rather
  // than nearly right: the mark is written at /sys sign-in only after the
  // server confirmed the account, so believing it here cannot show somebody
  // screens they have no claim to. The server's answer replaces it a moment
  // later either way, and every write is checked by the API on its own
  // terms — this decides what is drawn, never what is allowed.
  const [account, setAccount] = useState<Account>(() => {
    try {
      if (localStorage.getItem("smartdoc.system_session") === "1") {
        return { ...NO_ACCOUNT, is_customer_admin: true, is_sysadmin: true };
      }
    } catch {
      // Storage refused: the server's answer arrives shortly anyway.
    }
    return NO_ACCOUNT;
  });
  const [accountLoading, setAccountLoading] = useState(true);

  // Who the caller is across the customer. No project in the question, and
  // none needed in the answer.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      // Signed in is enough to ask. Not `user_id`: somebody who runs
      // SmartDoc itself has no row in `user` at all, so waiting for one
      // meant never asking, and never being told they are a sysadmin.
      if (!user) {
        setAccount(NO_ACCOUNT);
        setAccountLoading(false);
        return;
      }

      setAccountLoading(true);
      try {
        const token = await authService.ensureValidToken();
        const response = await fetch(`${API_URL}/user/me`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        });
        if (!response.ok) throw new Error("failed to resolve the account");
        const body = await response.json();
        if (!cancelled) setAccount(body.data || NO_ACCOUNT);
      } catch {
        if (!cancelled) setAccount(NO_ACCOUNT);
      } finally {
        if (!cancelled) setAccountLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!user?.user_id || !project?.project_id) {
        setMembership(NO_ACCESS);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const token = await authService.ensureValidToken();
        const response = await fetch(
          `${API_URL}/user_project/me/project/${project.project_id}`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
          }
        );
        if (!response.ok) throw new Error("failed to resolve membership");
        const body = await response.json();
        if (!cancelled) setMembership(body.data || NO_ACCESS);
      } catch {
        if (!cancelled) setMembership(NO_ACCESS);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [user?.user_id, project?.project_id]);

  return (
    <MembershipContext.Provider value={{ membership, account, loading, accountLoading }}>
      {children}
    </MembershipContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export const useMembership = () => useContext(MembershipContext);
