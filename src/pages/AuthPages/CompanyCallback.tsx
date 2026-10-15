import { useEffect, useState } from "react";
import { authService } from "../../services/authService";
import { cameFrom } from "../../services/companyLogin";

// Once per page. React runs effects twice in development, and Keycloak's
// answer can only be used once — the second run would report a failure on a
// sign-in that worked.
let started = false;

/**
 * Where the tab comes back to from a company login.
 *
 * **Drawn on its own, without the app around it** — `main.tsx` renders this
 * instead of `App` on this one path. The app's start-up would read whatever
 * session was there before and act on it — refresh it, lock it — while this
 * page is replacing it.
 *
 * It keeps the new session, checks the person belongs to the customer whose
 * page they started from, and goes on there. Only a refusal is shown.
 */
export default function CompanyCallback() {
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (started) return;
    started = true;
    authService
      .finishCompanySignIn()
      // replace(), so Back does not return to this page and try to use
      // Keycloak's answer a second time.
      .then((target) => window.location.replace(target))
      .catch((err) => setFailed(err instanceof Error ? err.message : "Sign-in could not be finished"));
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-white p-6 text-center text-sm text-gray-600 dark:bg-gray-900 dark:text-gray-400">
      {failed ? (
        <div className="max-w-md">
          <p className="text-error-500">{failed}</p>
          <a href={cameFrom()} className="mt-4 inline-block text-brand-500 hover:text-brand-600">
            Back to sign in
          </a>
        </div>
      ) : (
        <p>Signing in…</p>
      )}
    </div>
  );
}
