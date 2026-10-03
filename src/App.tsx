import { BrowserRouter as Router, Routes, Route } from "react-router";
import SignIn from "./pages/AuthPages/SignIn";
import SignInWithCustomer from "./pages/AuthPages/SignInWithCustomer";
import ProjectSelection from "./pages/AuthPages/ProjectSelection";
import SystemSignIn from "./pages/System/SystemSignIn";
import HomeRedirect from "./pages/HomeRedirect";
import SystemCustomers from "./pages/System/SystemCustomers";
import SystemLayout from "./pages/System/SystemLayout";
import SystemModels from "./pages/System/SystemModels";
import SignUp from "./pages/AuthPages/SignUp";
import Digitize from "./pages/Digitize";
import Users from "./pages/Users";
import UserAccess from "./pages/UserAccess";
import Projects from "./pages/Projects";
import Identifiers from "./pages/Identifiers";
import Attributes from "./pages/Attributes";
import Categories from "./pages/Categories";
import Storage from "./pages/Storage";
import CustomerSettings from "./pages/CustomerSettings";
import Assignments from "./pages/Assignments";
import ArrangeFile from "./pages/ArrangeFile";
import VerifyBatch from "./pages/VerifyBatch";
import MyAssignments from "./pages/MyAssignments";
import NotRecorded from "./pages/NotRecorded";
import NotFound from "./pages/OtherPage/NotFound";
import UserProfiles from "./pages/UserProfiles";
import Workspace from "./pages/Workspace";
import Videos from "./pages/UiElements/Videos";
import Images from "./pages/UiElements/Images";
import Alerts from "./pages/UiElements/Alerts";
import Badges from "./pages/UiElements/Badges";
import Avatars from "./pages/UiElements/Avatars";
import Buttons from "./pages/UiElements/Buttons";
import LineChart from "./pages/Charts/LineChart";
import BarChart from "./pages/Charts/BarChart";
import Calendar from "./pages/Calendar";
import BasicTables from "./pages/Tables/BasicTables";
import FormElements from "./pages/Forms/FormElements";
import Blank from "./pages/Blank";
import AppLayout from "./layout/AppLayout";
import { ScrollToTop } from "./components/common/ScrollToTop";
import Home from "./pages/Dashboard/Home";
import { AuthProvider } from "./context/AuthContext";
import { CustomerProvider } from "./context/CustomerContext";
import { ProjectProvider } from "./context/ProjectContext";
import { MembershipProvider } from "./context/MembershipContext";
import ProtectedRoute from "./components/common/ProtectedRoute";
import SessionExpiredPrompt from "./components/auth/SessionExpiredPrompt";

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

            {/* Others Page */}
            <Route path="/:customerUrl/profile" element={<UserProfiles />} />

            <Route path="/:customerUrl/calendar" element={<Calendar />} />

            <Route path="/:customerUrl/blank" element={<Blank />} />

            {/* Forms */}
            <Route path="/:customerUrl/form-elements" element={<FormElements />} />

            {/* Tables */}
            <Route path="/:customerUrl/basic-tables" element={<BasicTables />} />

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

            {/* Ui Elements */}
            <Route path="/:customerUrl/alerts" element={<Alerts />} />

            <Route path="/:customerUrl/avatars" element={<Avatars />} />

            <Route path="/:customerUrl/badge" element={<Badges />} />

            <Route path="/:customerUrl/buttons" element={<Buttons />} />

            <Route path="/:customerUrl/images" element={<Images />} />

            <Route path="/:customerUrl/videos" element={<Videos />} />

            {/* Charts */}
            <Route path="/:customerUrl/line-chart" element={<LineChart />} />

            <Route path="/:customerUrl/bar-chart" element={<BarChart />} />
          </Route>

          {/* Signin Entry Point */}
          <Route path="/signin" element={<SignIn />} />
          <Route path="/signup" element={<SignUp />} />

          {/* Fallback Route */}
          <Route path="*" element={<NotFound />} />
        </Routes>
          </Router>
          </MembershipProvider>
        </ProjectProvider>
      </CustomerProvider>
    </AuthProvider>
  );
}
