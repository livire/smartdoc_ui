import { SidebarProvider, useSidebar } from "../context/SidebarContext";
import AppHeader from "./AppHeader";
import Backdrop from "./Backdrop";
import AppSidebar from "./AppSidebar";

// The signed-in frame: sidebar, header, and one scrolling content area.
//
// It lives here rather than being written out at each call site because it was
// duplicated once already — inside SignInWithCustomer — and the copy drifted.
// Layout fixes applied to one silently missed the other, which is why the
// dashboard at /:customerUrl kept its old padding no matter what changed.
const ShellContent: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isExpanded, isHovered, isMobileOpen } = useSidebar();

  return (
    // h-screen, not min-h-screen: every list screen is built as an app shell
    // (its own header, its own scrolling body), and that only works if the
    // shell itself has a definite height to divide up.
    <div className="h-screen xl:flex overflow-hidden">
      <div>
        <AppSidebar />
        <Backdrop />
      </div>
      <div
        className={`flex-1 flex flex-col h-full min-h-0 transition-all duration-300 ease-in-out min-w-0 ${
          isExpanded || isHovered ? "lg:ml-[290px]" : "lg:ml-[90px]"
        } ${isMobileOpen ? "ml-0" : ""}`}
      >
        <AppHeader />
        {/* flex flex-col matters: every page's root is `flex-1`, and flex-1
            does nothing inside a plain block — that's what made pages size to
            their content and leave a grey band underneath. overflow-auto so
            pages that are NOT app shells can still scroll. */}
        <div className="flex flex-col flex-1 p-2 mx-auto w-full overflow-auto min-w-0 min-h-0">
          {children}
        </div>
      </div>
    </div>
  );
};

const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <SidebarProvider>
    <ShellContent>{children}</ShellContent>
  </SidebarProvider>
);

export default AppShell;
