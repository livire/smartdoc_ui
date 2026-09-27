import { Navigate, Outlet, useParams } from "react-router";
import AppShell from "./AppShell";
import { useCustomer, storedCustomerUrl } from "../context/CustomerContext";

/**
 * Routed pages render inside the shared shell — and only for the customer
 * whose url they are under.
 *
 * Every screen lives under `/:customerUrl`, so the url always names a
 * customer. The session belongs to one too. When they differ, this is
 * somebody else's address: the sign-in page for it is the answer, and the
 * session that is open stays open, so going back to its own url still
 * works. Nothing is signed out — a mistyped address should not cost
 * somebody their morning.
 */
const AppLayout: React.FC = () => {
  const { customer } = useCustomer();
  const { customerUrl } = useParams<{ customerUrl: string }>();

  const sessionUrl = customer?.customer_url ?? storedCustomerUrl();

  if (customerUrl && sessionUrl && customerUrl !== sessionUrl) {
    return <Navigate to={`/${customerUrl}`} replace />;
  }

  // SmartDoc's own session never renders a customer's screens. Whatever it
  // needs to do to a customer, it does under /sys — see
  // pages/System/SystemCustomerDetail.tsx.
  const isSystemSession = localStorage.getItem("smartdoc.system_session") === "1";
  if (isSystemSession) {
    return <Navigate to="/sys/customers" replace />;
  }

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
};

export default AppLayout;
