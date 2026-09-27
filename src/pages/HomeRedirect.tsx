import { Navigate } from "react-router";
import { storedCustomerUrl } from "../context/CustomerContext";

/**
 * What "/" means.
 *
 * Every screen lives under its customer's url. Somebody arriving at the bare
 * root — a bookmark, a typed address, a link from outside — is sent to their
 * own customer if the browser knows which that is, and otherwise told where
 * to go. It used to render the dashboard directly, which is how a session
 * could be shown under no customer at all, and how links built from the
 * address bar came out missing one.
 */
export default function HomeRedirect() {
  const customerUrl = storedCustomerUrl();

  if (customerUrl) return <Navigate to={`/${customerUrl}`} replace />;

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="text-center">
        <h1 className="mb-2 text-xl font-semibold text-gray-800 dark:text-white/90">
          Open your organisation's SmartDoc link
        </h1>
        <p className="text-gray-600 dark:text-gray-400">
          SmartDoc is reached at your organisation's own address, such as
          <span className="font-mono"> /your-organisation</span>.
        </p>
      </div>
    </div>
  );
}
