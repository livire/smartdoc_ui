import { useEffect, useState } from "react";
import { useParams, Navigate, useNavigate } from "react-router";
import PageMeta from "../../components/common/PageMeta";
import AuthLayout from "./AuthPageLayout";
import SignInForm from "../../components/auth/SignInForm";
import { useCustomer } from "../../context/CustomerContext";
import { useAuth } from "../../context/AuthContext";
import { useProject } from "../../context/ProjectContext";
import { customerService, CustomerDetails } from "../../services/customerService";
import { authService } from "../../services/authService";
import AppShell from "../../layout/AppShell";
import Home from "../Dashboard/Home";

export default function SignInWithCustomer() {
  const { customerUrl } = useParams<{ customerUrl: string }>();
  const navigate = useNavigate();
  const { customer, setCustomer } = useCustomer();
  const { isAuthenticated, isLoading: authLoading, user } = useAuth();
  const { setProject, clearProject } = useProject();
  // Whether the stored project has been checked against this user's own
  // projects. Until it has, the dashboard must not be drawn: a project left
  // behind by whoever used this browser last would draw somebody else's
  // work for a moment.
  const [projectChecked, setProjectChecked] = useState(false);
  const [isCustomerAdmin, setIsCustomerAdmin] = useState(false);
  // Set when this url's customer is not the one the open session belongs
  // to. The session stays; this page becomes a plain sign-in for the
  // customer in the address.
  const [otherCustomer, setOtherCustomer] = useState<CustomerDetails | null>(null);
  // A system session is nobody's customer. Landing on a customer's url with
  // one used to walk straight into that customer — the same act as pressing
  // Open on the customer list, but unasked for.
  const isSystemSession = localStorage.getItem("smartdoc.system_session") === "1";
  // Whether this person is a member of any project. A customer
  // administrator with none has nothing to choose from, and is sent to the
  // customer's own screens instead of to an empty chooser.
  const [hasProjects, setHasProjects] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [validCustomer, setValidCustomer] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const validateCustomer = async () => {
      if (!customerUrl) {
        if (isMounted) {
          setError("Customer ID is required");
          setLoading(false);
        }
        return;
      }

      try {
        const response = await customerService.getCustomerByUrl(customerUrl);

        if (!isMounted) return;

        if (!response || !response.data) {
          setError("No customer data received from server");
          setValidCustomer(false);
          return;
        }

        const customerData = response.data;

        if (!customerData.customer_id || !customerData.customer_name) {
          setError("Invalid customer data received");
          setValidCustomer(false);
          return;
        }

        if (!customerService.validateCustomer(customerData)) {
          setError(
            `The account for ${customerData.customer_name} is currently inactive. Please contact support to activate your account.`
          );
          setValidCustomer(false);
          return;
        }

        // The url names a customer; the session belongs to one. If they are
        // not the same, this is not the session's customer — show this
        // customer's sign-in page and leave the other session alone. It
        // used to sign the person out, which meant a mistyped or
        // half-remembered address cost them the session they had; an
        // address that matches no customer at all never did that, and this
        // should be no different.
        //
        // "Signed in" is the operative word: with no session open, a stored
        // customer is only what the last visit left behind, and this url
        // simply replaces it. Treating the leftover as a session showed the
        // previous customer's logo on this one's sign-in page and then
        // checked the credentials against the wrong customer — "User does
        // not have access to this customer", for a user who did.
        let signedInElsewhere = false;
        try {
          const stored = localStorage.getItem("customer_data");
          const previous = stored ? JSON.parse(stored)?.customer_id : null;
          const sessionOpen = Boolean(authService.getStoredUser() && authService.getStoredToken());
          signedInElsewhere =
            sessionOpen && previous !== null && String(previous) !== String(customerData.customer_id);
        } catch {
          signedInElsewhere = false;
        }

        if (signedInElsewhere) {
          // Not stored: storing it would switch the whole application to a
          // customer nobody has signed in to. The page reads what it needs
          // from `customerData` and asks for a password.
          setOtherCustomer(customerData);
          setValidCustomer(true);
          return;
        }

        setCustomer(customerData);
        setValidCustomer(true);
      } catch (err) {
        if (isMounted) {
          const errorMessage = err instanceof Error ? err.message : "Invalid customer URL";
          setError(errorMessage);
          setValidCustomer(false);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    validateCustomer();

    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerUrl]);

  // Check projects when user authenticates
  useEffect(() => {
    let isMounted = true;

    const checkProjects = async () => {
      console.log("checkProjects called - isAuthenticated:", isAuthenticated, "user:", user);

      if (!isAuthenticated || !user) {
        console.log("Not authenticated or no user, returning");
        return;
      }

      // Once per session, not once per render.
      if (sessionStorage.getItem("projects_checked")) {
        setProjectChecked(true);
        return;
      }

      try {
        const token = await authService.ensureValidToken();
        const [response, me] = await Promise.all([
          authService.getUserProjects(user.user_id!, token),
          authService.getMe(token),
        ]);
        if (!isMounted) return;

        const mine = response.data ?? [];
        setIsCustomerAdmin(Boolean(me.is_customer_admin));
        setHasProjects(mine.length > 0);

        // A project chosen in this browser before is only good if it is
        // still one of this user's. It survives a session ending — the
        // tokens go, this key does not — so without the check, signing in
        // as somebody else, or after losing access to a project, went
        // straight past the selection screen into a project that is not
        // theirs.
        let stored: { user_project_id?: number; user_id?: number } | null = null;
        try {
          const raw = localStorage.getItem("selected_project");
          stored = raw ? JSON.parse(raw) : null;
        } catch {
          stored = null;
        }

        const storedIsMine =
          !!stored &&
          mine.some(
            (p) =>
              Number(p.user_project_id) === Number(stored?.user_project_id) &&
              Number(p.user_id) === Number(user.user_id),
          );

        if (stored && !storedIsMine) clearProject();

        sessionStorage.setItem("projects_checked", "true");

        if (mine.length === 1) {
          // Nothing to choose between.
          if (!storedIsMine) setProject(mine[0]);
        } else if (mine.length > 1 && !storedIsMine) {
          // A customer administrator with projects of their own still picks
          // one: being able to set the customer up does not say which
          // project they mean to work in. Only somebody with none at all
          // skips the chooser, below.
          navigate(`/${customerUrl}/select-project`);
          return;
        }

        setProjectChecked(true);
      } catch (err) {
        console.error("Failed to check projects:", err);
        // Let the screen decide on what is stored rather than hanging on a
        // loader nobody can get past.
        if (isMounted) setProjectChecked(true);
      }
    };

    checkProjects();

    return () => {
      isMounted = false;
    };
  }, [isAuthenticated, user, customerUrl, setProject, clearProject, navigate]);

  if (loading) {
    return (
      <>
        {/* The sign-in page's own title from the first frame: a "Loading"
            title here was what the tab kept showing, the swap to the real
            one not always landing. Nothing is lost — the spinner says
            loading. */}
        <PageMeta title="Sign in | SmartDoc" description="Sign in to SmartDoc" />
        <AuthLayout>
          <div className="flex flex-col flex-1 items-center justify-center">
            <div className="w-full max-w-md">
              <div className="mb-12 text-center">
                <div className="mb-8 flex justify-center">
                  <div className="relative inline-flex">
                    <div className="absolute inset-0 rounded-full bg-gradient-to-r from-brand-500 to-brand-600 opacity-25 blur-lg animate-pulse"></div>
                    <div className="relative inline-flex items-center justify-center w-20 h-20 rounded-full bg-gradient-to-br from-brand-500 to-brand-600">
                      <div className="w-12 h-12 border-4 border-white border-t-transparent rounded-full animate-spin"></div>
                    </div>
                  </div>
                </div>

                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                  Loading Workspace
                </h2>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
                  Fetching your customer information...
                </p>

              </div>
            </div>
          </div>
        </AuthLayout>
      </>
    );
  }

  if (error || !validCustomer) {
    return (
      <>
        <PageMeta
          title="Invalid customer | SmartDoc"
          description="Invalid customer"
        />
        <AuthLayout>
          <div className="flex flex-col flex-1 items-center justify-center">
            <div className="w-full max-w-md">
              <div className="mb-6 text-center">
                <div className="mb-6 flex justify-center">
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-error-100 dark:bg-error-900/30">
                    <svg
                      className="w-8 h-8 text-error-600 dark:text-error-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 8v4m0 4v.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                  </div>
                </div>

                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                  Access Denied
                </h2>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
                  {error || "Invalid or inactive customer"}
                </p>

                <div className="p-4 rounded-lg bg-error-50 dark:bg-error-950 border border-error-200 dark:border-error-800">
                  <p className="text-xs text-error-700 dark:text-error-300">
                    If you believe this is an error, please contact your administrator or check your customer URL.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </AuthLayout>
      </>
    );
  }

  if (!customer) {
    return <Navigate to="/signin" replace />;
  }

  // A customer's address, with SmartDoc's own session open. The two do not
  // meet: a system account has no business rendering a customer's screens,
  // and everything it may do to a customer it does under /sys.
  if (isSystemSession && isAuthenticated) {
    return <Navigate to="/sys/customers" replace />;
  }

  // Somebody else's customer: the sign-in form, whatever session is open.
  if (otherCustomer) {
    return (
      <>
        <PageMeta
          title={`Sign in - ${otherCustomer.customer_name} | SmartDoc`}
          description={`Sign in to ${otherCustomer.customer_name}`}
        />
        <AuthLayout>
          <SignInForm forCustomer={otherCustomer} />
        </AuthLayout>
      </>
    );
  }

  // Render dashboard if authenticated AND project is selected
  if (isAuthenticated && !authLoading) {
    const storedProject = localStorage.getItem("selected_project");

    // Not until the stored project has been checked against this user's own
    // projects: drawing the dashboard first would show whoever used this
    // browser last their colleague's work for a moment.
    if (!projectChecked) {
      return (
        <>
          <PageMeta title="SmartDoc" description="Loading your projects" />
          <AuthLayout>
            <div className="flex flex-1 items-center justify-center">
              <span className="block size-8 rounded-full border-4 border-brand-500 border-t-transparent animate-spin" />
            </div>
          </AuthLayout>
        </>
      );
    }

    // No project chosen. A customer administrator does not need one — their
    // work is the customer's projects, storages, users and branding — so
    // they land on the projects list instead of being stopped at a chooser.
    if (!storedProject) {
      return isCustomerAdmin && !hasProjects ? (
        <Navigate to={`/${customerUrl}/customer-settings`} replace />
      ) : (
        <Navigate to={`/${customerUrl}/select-project`} replace />
      );
    }

    return (
      <>
        <PageMeta
          title={`Dashboard - ${customer.customer_name} | SmartDoc`}
          description={`Dashboard for ${customer.customer_name}`}
        />
        {/* The same shell every signed-in screen uses, rather than a second
            copy of it — see layout/AppShell.tsx. */}
        <AppShell>
          <Home />
        </AppShell>
      </>
    );
  }

  return (
    <>
      <PageMeta
        title={`Sign in - ${customer.customer_name} | SmartDoc`}
        description={`Sign in to ${customer.customer_name}`}
      />
      <AuthLayout>
        <SignInForm />
      </AuthLayout>
    </>
  );
}
