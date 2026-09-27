import { Navigate, NavLink, Outlet } from "react-router";
import AuthLayout from "../AuthPages/AuthPageLayout";
import Button from "../../components/ui/button/Button";
import { useAuth } from "../../context/AuthContext";
import { useMembership } from "../../context/MembershipContext";
import { GroupIcon, BoxCubeIcon } from "../../icons";

/**
 * The frame every system screen sits in: header with the product's mark and
 * the way out, a menu of the system's own areas on the left, the screen in
 * the middle. Nothing here belongs to a customer — the SaaS owner's space,
 * kept apart from every customer's (see AppLayout for the other side).
 *
 * The guards live here rather than in each screen, so a screen added later
 * cannot forget them: signed in, and confirmed by the server to be a system
 * account before anything is drawn.
 */
const SYSTEM_MENU = [
  { name: "Customers", path: "/sys/customers", icon: <GroupIcon /> },
  { name: "AI Models", path: "/sys/models", icon: <BoxCubeIcon /> },
];

export default function SystemLayout() {
  const { isAuthenticated, logout, user } = useAuth();
  const { account, accountLoading } = useMembership();

  if (!isAuthenticated) return <Navigate to="/sys" replace />;

  // Nothing is decided until the server has said who this is. Drawing the
  // screens first and correcting afterwards is how a customer's own user
  // got a glimpse of screens that were never theirs.
  if (accountLoading) {
    return (
      <AuthLayout>
        <div className="flex flex-1 items-center justify-center">
          <span className="block size-8 rounded-full border-4 border-brand-500 border-t-transparent animate-spin" />
        </div>
      </AuthLayout>
    );
  }

  // The API refuses everything here to anyone else, but there is no reason
  // to show an empty screen and an error where a plain answer will do.
  if (!account.is_sysadmin) {
    return (
      <AuthLayout>
        <div className="flex flex-1 items-center justify-center px-6">
          <div className="text-center">
            <h1 className="mb-2 text-xl font-semibold text-gray-800 dark:text-white/90">
              Not a system account
            </h1>
            <p className="mb-6 text-gray-600 dark:text-gray-400">
              Sign in at your own organisation's SmartDoc address instead.
            </p>
            <Button size="sm" variant="outline" onClick={logout}>
              Sign out
            </Button>
          </div>
        </div>
      </AuthLayout>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-white dark:bg-gray-900">
      {/* The mark on the left where a product's mark goes, and who you are
          with the way out hard right. */}
      <div className="flex flex-shrink-0 items-center justify-between gap-4 border-b border-gray-200 px-6 py-3 dark:border-gray-800">
        <img src="/images/logo/smartdoc-logo.png" alt="SmartDoc" className="h-14 w-auto" />
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-200">
            <svg viewBox="0 0 24 24" fill="currentColor" className="size-4 text-gray-400">
              <path d="M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5Zm0 2c-4 0-8 2-8 5v1h16v-1c0-3-4-5-8-5Z" />
            </svg>
            {user?.preferred_username ?? "system"}
          </span>
          {/* The same round button the app header uses for its tools. */}
          <button
            type="button"
            title="Sign out"
            onClick={() => {
              logout();
              localStorage.removeItem("smartdoc.system_session");
              window.location.assign("/sys");
            }}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="size-5">
              <path d="M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5v-2H5V5h5V3Zm6.2 3.6-1.4 1.4 2 2H9v2h7.8l-2 2 1.4 1.4L21 12l-4.8-5.4Z" />
            </svg>
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* The system's areas. The same look as the app's menu, without
            the groups: there are two entries and neither needs a heading. */}
        <nav className="flex w-56 flex-shrink-0 flex-col gap-1 border-r border-gray-200 px-3 py-4 dark:border-gray-800">
          {SYSTEM_MENU.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                `menu-item group ${isActive ? "menu-item-active" : "menu-item-inactive"}`
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={`menu-item-icon-size ${
                      isActive ? "menu-item-icon-active" : "menu-item-icon-inactive"
                    }`}
                  >
                    {item.icon}
                  </span>
                  <span className="menu-item-text">{item.name}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
