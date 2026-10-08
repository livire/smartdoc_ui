import { Link, useLocation } from "react-router";
import { useCustomer } from "../../context/CustomerContext";

const pageTitles: Record<string, string> = {
  "": "Dashboard",
  workspace: "Workspace",
  profile: "Profile",
  notifications: "Notifications",
  digitize: "Digitize",
  verify: "Verify",
  assignments: "My Assignments",
  "new-assignment": "New Assignment",
  users: "Users",
  alerts: "Alerts",
  avatars: "Avatars",
  badge: "Badges",
  buttons: "Buttons",
  images: "Images",
  videos: "Videos",
  "line-chart": "Line Chart",
  "bar-chart": "Bar Chart",
};

const humanize = (slug: string) =>
  slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

const getPageTitle = (pathname: string) => {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return pageTitles[""];

  // Walk back from the end, skipping record ids: /verify/12 is the Verify
  // screen, and showing "12" told the reader nothing about where they were.
  const named = [...segments].reverse().find((segment) => !/^\d+$/.test(segment));

  if (named && pageTitles[named] !== undefined) return pageTitles[named];

  // A single unmatched segment is the customer URL slug itself (dashboard root)
  if (segments.length === 1) return pageTitles[""];

  // Two segments where the last is an id, e.g. /super/12 — still the dashboard
  // root for that customer rather than a page of its own.
  if (!named || named === segments[0]) return pageTitles[""];

  return humanize(named);
};

const PageBreadcrumb: React.FC = () => {
  const location = useLocation();
  const { customer } = useCustomer();
  const homePath = customer?.customer_url ? `/${customer.customer_url}` : "/";
  const pageTitle = getPageTitle(location.pathname);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <nav>
        <ol className="flex items-center gap-1.5">
          <li>
            <Link
              className="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400"
              to={homePath}
            >
              Home
              <svg
                className="stroke-current"
                width="17"
                height="16"
                viewBox="0 0 17 16"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M6.0765 12.667L10.2432 8.50033L6.0765 4.33366"
                  stroke=""
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </Link>
          </li>
          <li className="text-sm text-gray-800 dark:text-white/90">
            {pageTitle}
          </li>
        </ol>
      </nav>
    </div>
  );
};

export default PageBreadcrumb;
