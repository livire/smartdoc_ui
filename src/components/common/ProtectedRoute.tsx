import { useEffect, useState } from "react";
import { Navigate } from "react-router";
import { useAuth } from "../../context/AuthContext";
import { useCustomer } from "../../context/CustomerContext";
import { authService } from "../../services/authService";

// The customer whose sign-in page to return to, read straight from storage
// because the context is not populated yet on a cold load.
function storedCustomerUrl(): string | null {
  try {
    const stored = localStorage.getItem("customer_data");
    return stored ? JSON.parse(stored)?.customer_url ?? null : null;
  } catch {
    return null;
  }
}

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isAuthenticated, isLoading, logout } = useAuth();
  const { customer } = useCustomer();
  const [tokenValid, setTokenValid] = useState(false);
  // Which value of `isAuthenticated` the check below has actually answered
  // for. Null until it has answered at all.
  //
  // A boolean "checking" flag cannot do this job: React renders before it
  // runs effects, so the render in which somebody becomes signed in still
  // saw the previous answer — "not checking, not valid" — and redirected to
  // the sign-in route for one frame. With a project stored that looked like
  // nothing; without one, sign-in forwards to the project chooser, which is
  // where "Continue without a project" kept landing. Comparing against the
  // value it was answered for makes the stale answer unusable at render
  // time, where the decision is taken.
  const [validatedFor, setValidatedFor] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;

    const validateToken = async () => {
      if (!isAuthenticated) {
        if (!cancelled) {
          setTokenValid(false);
          setValidatedFor(false);
        }
        return;
      }

      try {
        await authService.ensureValidToken();
        if (!cancelled) setTokenValid(true);
      } catch {
        logout();
        if (!cancelled) setTokenValid(false);
      } finally {
        if (!cancelled) setValidatedFor(true);
      }
    };

    validateToken();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, logout]);

  const checkingToken = validatedFor !== isAuthenticated;

  if (isLoading || checkingToken) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 mb-4 rounded-full bg-brand-50">
            <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin"></div>
          </div>
          <p className="text-gray-600 dark:text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated || !tokenValid) {
    // The context is empty on a fresh page load, but the customer we last
    // signed in under is still on disk — signing out does not clear it.
    const customerUrl = customer?.customer_url ?? storedCustomerUrl();

    if (customerUrl) {
      return <Navigate to={`/${customerUrl}`} replace />;
    }

    // Without a customer there is no sign-in page to go to. This used to
    // navigate to "/", which is this same guarded route — so the guard ran
    // again, navigated again, and the screen stayed blank.
    return (
      <div className="flex items-center justify-center min-h-screen px-6">
        <div className="text-center">
          <h1 className="mb-2 text-xl font-semibold text-gray-800 dark:text-white/90">
            You have been signed out
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Open your organisation's SmartDoc link to sign in again.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
