import { lazy, Suspense } from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router";
import SignIn from "./pages/AuthPages/SignIn";
import SignInWithCustomer from "./pages/AuthPages/SignInWithCustomer";
import SystemSignIn from "./pages/System/SystemSignIn";
import HomeRedirect from "./pages/HomeRedirect";
import SystemLayout from "./pages/System/SystemLayout";
import NotFound from "./pages/OtherPage/NotFound";
import AppLayout from "./layout/AppLayout";
import { ScrollToTop } from "./components/common/ScrollToTop";
import { AuthProvider } from "./context/AuthContext";
import { CustomerProvider } from "./context/CustomerContext";
import { ProjectProvider } from "./context/ProjectContext";
import { MembershipProvider } from "./context/MembershipContext";
import ProtectedRoute from "./components/common/ProtectedRoute";
import SessionExpiredPrompt from "./components/auth/SessionExpiredPrompt";

/**
 * Every screen behind sign-in is fetched when it is first opened, not when
 * the app loads.
 *
 * Without this, somebody looking at the sign-in form downloads Digitize, the
 * verification screen and every setup page before they can type a username.
 * The sign-in pages themselves stay eager — splitting the first screen only
 * adds a round trip before anything can be drawn.
 */
const ProjectSelection = lazy(() => import("./pages/AuthPages/ProjectSelection"));
const SystemCustomers = lazy(() => import("./pages/System/SystemCustomers"));
const SystemModels = lazy(() => import("./pages/System/SystemModels"));
const SignUp = lazy(() => import("./pages/AuthPages/SignUp"));
const Digitize = lazy(() => import("./pages/Digitize"));
const Users = lazy(() => import("./pages/Users"));
const UserAccess = lazy(() => import("./pages/UserAccess"));
const Projects = lazy(() => import("./pages/Projects"));
const Identifiers = lazy(() => import("./pages/Identifiers"));
const Attributes = lazy(() => import("./pages/Attributes"));
const Categories = lazy(() => import("./pages/Categories"));
const Storage = lazy(() => import("./pages/Storage"));
const CustomerSettings = lazy(() => import("./pages/CustomerSettings"));
const Assignments = lazy(() => import("./pages/Assignments"));
const ArrangeFile = lazy(() => import("./pages/ArrangeFile"));
const VerifyBatch = lazy(() => import("./pages/VerifyBatch"));
const MyAssignments = lazy(() => import("./pages/MyAssignments"));
const NotRecorded = lazy(() => import("./pages/NotRecorded"));
const UserProfiles = lazy(() => import("./pages/UserProfiles"));
const Workspace = lazy(() => import("./pages/Workspace"));
const Notifications = lazy(() => import("./pages/Notifications"));
const Home = lazy(() => import("./pages/Dashboard/Home"));

export default function App() {
  return (
    <AuthProvider>
      <CustomerProvider>
        <ProjectProvider>
          <MembershipProvider>
          <Router>
          <ScrollToTop />
          {/* Sits above every screen: an expired session asks for a password
              here instead of throwing anyone back to sign-in. */}
          <SessionExpiredPrompt />
          {/* Shown while a screen is being fetched. Deliberately plain and
              unbranded: it is on screen for a few hundred milliseconds on a
              first visit and never again, and a logo that flashes there
              looks like a fault. */}
          <Suspense
            fallback={
              <div className="flex min-h-[60vh] items-center justify-center">
                <span className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-brand-500 dark:border-gray-700 dark:border-t-brand-400" />
              </div>
            }
          >
          <Routes>
          {/* Customer-Specific Route (signin/dashboard - accessible to everyone) */}
          <Route path="/:customerUrl" element={<SignInWithCustomer />} />

          {/* Project Selection Route */}
          {/* SmartDoc itself, not a customer. Before the customer routes, so
              "sys" is never read as somebody's sign-in address. */}
          {/* Bare paths no longer exist: every screen lives under its
              customer's url, so a link can never be built without one —
              `//select-project`, which a browser reads as another host,
              was the last of that family of bugs. "/" is the one exception
              and means "take me to my own customer". */}
          <Route path="/" element={<HomeRedirect />} />
          <Route path="/sys" element={<SystemSignIn />} />
          {/* The system's own shell: its menu, its guards, its screens. */}
          <Route element={<SystemLayout />}>
            <Route path="/sys/customers" element={<SystemCustomers />} />
            <Route path="/sys/models" element={<SystemModels />} />
          </Route>
          {/* Dashboard Layout (protected) */}
          <Route
            element={
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            }
          >
            <Route path="/:customerUrl" element={<Home />} />
            {/* Inside the shell, not in front of it: the menu and the user
                menu are there while a project is still to be chosen. */}
            <Route path="/:customerUrl/select-project" element={<ProjectSelection />} />

            {/* Workspace */}
            <Route path="/:customerUrl/workspace" element={<Workspace />} />

            {/* Everything the bell has shown, kept and paged. */}
            <Route path="/:customerUrl/notifications" element={<Notifications />} />

            {/* Others Page */}
            <Route path="/:customerUrl/profile" element={<UserProfiles />} />

            {/* Documents */}
            <Route path="/:customerUrl/digitize" element={<Digitize />} />

            <Route path="/:customerUrl/users" element={<Users />} />
            {/* One person's access to every project, on one screen. */}
            <Route path="/:customerUrl/users/:userId/access" element={<UserAccess />} />

            <Route path="/:customerUrl/projects" element={<Projects />} />

            <Route path="/:customerUrl/identifiers" element={<Identifiers />} />

            <Route path="/:customerUrl/attributes" element={<Attributes />} />

            <Route path="/:customerUrl/categories" element={<Categories />} />

            <Route path="/:customerUrl/storage" element={<Storage />} />

            <Route path="/:customerUrl/customer-settings" element={<CustomerSettings />} />

            <Route path="/:customerUrl/my-assignments" element={<MyAssignments />} />
            <Route path="/:customerUrl/not-recorded" element={<NotRecorded />} />

            <Route path="/:customerUrl/arrange" element={<ArrangeFile />} />
            <Route path="/:customerUrl/assignments" element={<Assignments />} />
            {/* Old links: this screen was /new-assignment when all it did was
                hand work out. It now also moves and ends batches. */}
            <Route path="/:customerUrl/new-assignment" element={<Assignments />} />

            {/* Verification. The queue lives on the dashboard now — this is
                the screen for working through one batch. */}
            <Route path="/:customerUrl/verify/:assignmentId" element={<VerifyBatch />} />

            {/* Bare /verify opens whatever batch you're holding, the way
                /digitize opens the assignment you're capturing. */}
            <Route path="/:customerUrl/verify" element={<VerifyBatch />} />

          </Route>

          {/* Signin Entry Point */}
          <Route path="/signin" element={<SignIn />} />
          <Route path="/signup" element={<SignUp />} />

          {/* Fallback Route */}
          <Route path="*" element={<NotFound />} />
        </Routes>
          </Suspense>
          </Router>
          </MembershipProvider>
        </ProjectProvider>
      </CustomerProvider>
    </AuthProvider>
  );
}
