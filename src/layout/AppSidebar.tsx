import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { authService } from "../services/authService";
import { documentService } from "../services/documentService";
import { projectSettingService } from "../services/projectSettingService";
import { useProject } from "../context/ProjectContext";
import { customerService } from "../services/customerService";
import LogoPlaceholder from "../components/common/LogoPlaceholder";

// Assume these icons are imported from an icon library
import {
  ChevronDownIcon,
  FolderIcon,
  GridIcon,
  GroupIcon,
  HorizontaLDots,
  PlugInIcon,
  TaskIcon,
} from "../icons";
import { useSidebar } from "../context/SidebarContext";
import { useMembership } from "../context/MembershipContext";
import { useCustomer, storedCustomerUrl } from "../context/CustomerContext";
import { useTheme } from "../context/ThemeContext";

type NavItem = {
  name: string;
  icon: React.ReactNode;
  path?: string;
  subItems?: {
    name: string;
    path: string;
    pro?: boolean;
    new?: boolean;
    adminOnly?: boolean;
    // Needs `can_capture` — the screens where the work is done.
    workOnly?: boolean;
  }[];
  // Only rendered for a project admin. Cosmetic — the API enforces the same
  // rule, so hiding these just avoids offering actions that would be refused.
  adminOnly?: boolean;
  // Only for a customer administrator, and shown whether or not a project is
  // selected: these screens are about the customer, not about one project.
  customerAdminOnly?: boolean;
  // Meaningless without a project, so hidden until one is chosen.
  needsProject?: boolean;
};

const navItems: NavItem[] = [
  {
    icon: <GridIcon />,
    name: "Dashboard",
    path: "/",
    // The queue and "my work" are both a project's, so there is nothing to
    // show a customer administrator who has not opened one.
    needsProject: true,
  },
  {
    icon: <TaskIcon />,
    name: "Workspace",
    needsProject: true,
    // The work, for whoever does it. Digitize and Verify are the two work
    // surfaces — each opens whatever that person is holding. Claiming happens
    // on the dashboard, which lists the queue. The last two are the
    // supervisor's half — handing work out and putting a file in order —
    // and show only to a project admin; one group rather than two, because
    // "Administration" beside "Workspace" read as somewhere else to go
    // rather than the same work seen from above.
    subItems: [
      // Doing the work, so not for a viewer — who is a member of the
      // project and may read its finished documents in the viewer app, but
      // captures nothing and verifies nothing. Without workOnly a viewer
      // signing in here would see Digitize, open it, and be refused by the
      // API with nothing on screen explaining why.
      { name: "My Assignments", path: "/my-assignments", pro: false, workOnly: true },
      { name: "Digitize", path: "/digitize", pro: false, workOnly: true },
      { name: "Verify", path: "/verify", pro: false, workOnly: true },
      // What was uploaded but never recorded; also announced on the
      // dashboard when there is anything in it.
      { name: "Not Recorded", path: "/not-recorded", pro: false, workOnly: true },
      { name: "Assignments", path: "/assignments", pro: false, adminOnly: true },
      // Putting a whole file in order crosses every batch ever captured
      // against a folio, so it is its own screen.
      { name: "Sequencing", path: "/arrange", pro: false, adminOnly: true },
    ],
  },
  {
    icon: <PlugInIcon />,
    // What belongs to the customer rather than to any one project: the
    // projects themselves, where their documents live, and how SmartDoc
    // looks. None of it needs a project open, and a customer administrator
    // may have none at all.
    name: "Customer Setup",
    customerAdminOnly: true,
    subItems: [
      { name: "Customer", path: "/customer-settings", pro: false },
      { name: "Projects", path: "/projects", pro: false },
      { name: "Storage", path: "/storage", pro: false },
    ],
  },
  {
    icon: <PlugInIcon />,
    // What one project is made of. A project admin sets these up for the
    // project they are in.
    name: "Project Setup",
    adminOnly: true,
    needsProject: true,
    subItems: [
      { name: "Categories", path: "/categories", pro: false },
      { name: "Attributes", path: "/attributes", pro: false },
      { name: "Identifiers", path: "/identifiers", pro: false },
    ],
  },
  {
    icon: <GroupIcon />,
    name: "User Management",
    customerAdminOnly: true,
    subItems: [{ name: "Users", path: "/users", pro: false }],
  },
];

const othersItems: NavItem[] = [];

const AppSidebar: React.FC = () => {
  const { membership, account } = useMembership();
  const { project } = useProject();
  const { customer } = useCustomer();

  // Setup and user management belong to project admins. Filtered here rather
  // than inside renderMenuItems so the index-based open/close state below
  // stays aligned with what is actually on screen.
  // No project open yet: the project's groups stay on the menu, greyed and
  // not clickable, so the shape of the app is visible before the choice is
  // made and nothing appears to be missing. Admin-only groups wait — who is
  // an admin is a fact about the project, unknown until one is open.
  const noProject = !project?.project_id;
  // Every link on this menu is under the customer's url. The context is the
  // first source; the address bar is the second, because the context can be
  // empty for a frame or for a session that never stored the customer —
  // and a bare "/users" is read as a customer called "users".
  const base = `/${customer?.customer_url ?? storedCustomerUrl() ?? ""}`;
  const visibleNavItems = navItems
    .filter((nav) => {
      if (nav.customerAdminOnly) return account.is_customer_admin;
      if (nav.needsProject && noProject) return !nav.adminOnly;
      return !nav.adminOnly || membership.can_setup;
    })
    // Entries inside a group can be admin-only too, for a group that mixes
    // doing the work with handing it out.
    .map((nav) =>
      nav.subItems
        ? {
            ...nav,
            subItems: nav.subItems.filter(
              (sub) =>
                (!sub.adminOnly || membership.can_setup) &&
                (!sub.workOnly || membership.can_capture),
            ),
          }
        : nav,
    )
    // A viewer has none of the Workspace entries, and a heading that opens
    // onto nothing is worse than no heading.
    .filter((nav) => !nav.subItems || nav.subItems.length > 0);

  const { isExpanded, isMobileOpen, isHovered, setIsHovered } = useSidebar();
  const location = useLocation();

  const [openSubmenu, setOpenSubmenu] = useState<{
    type: "main" | "others";
    index: number;
  } | null>(null);
  // Which project this is, and what its pipeline does. Above the menu because
  // it is the thing every screen below is about — and on a project with
  // categorisation off, "Not categorised" is a finished state, not a wait.
  const [projectName, setProjectName] = useState<string | null>(null);
  // The customer's own logo and name, when they have set them.
  const [branding, setBranding] = useState<{
    label: string | null;
    logo: string | null;
    logoDark: string | null;
  }>(
    () => {
      // Straight from the cache, so the logo is on screen in the first
      // paint rather than after a token and a request.
      const cached = customer?.customer_id
        ? customerService.readCachedSettings(customer.customer_id)
        : // CustomerContext is still empty on the first render, so fall back
          // to the customer stored in the browser.
          customerService.readCachedSettingsForStoredCustomer();
        // Either logo will do: a customer who sets one and not the other
      // should see it everywhere rather than a placeholder on half the
      // screens.
      return {
        label: cached?.customer_label ?? null,
        logo: cached?.menu_logo ?? cached?.login_logo ?? null,
        logoDark: cached?.menu_logo_dark ?? cached?.login_logo_dark ?? null,
      };
    },
  );
  // The customer's mark for the screen somebody is actually on. Falls back
  // to the light one: most logos read on either background, and a customer
  // who set only the one should see it rather than nothing.
  const { theme } = useTheme();
  const shownLogo = theme === "dark" ? branding.logoDark || branding.logo : branding.logo;

  const [autoStages, setAutoStages] = useState<{
    process: boolean;
    analyze: boolean;
    ocr: boolean;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // Usually the context knows which customer this is. When it does
        // not — a reload that lost it, or a screen reached without going
        // through sign-in — the url in the address bar still says, and a
        // blank corner where the customer's logo belongs is worse than one
        // extra request.
        let customerId = customer?.customer_id ?? null;
        if (!customerId) {
          const url = storedCustomerUrl();
          if (!url) return;
          const response = await customerService.getCustomerByUrl(url);
          customerId = response?.data?.customer_id ?? null;
        }
        if (!customerId || cancelled) return;

        const settings = await customerService.getSettings(customerId);
        if (!cancelled) {
          setBranding({
            label: settings?.customer_label ?? null,
            logo: settings?.menu_logo ?? settings?.login_logo ?? null,
            logoDark: settings?.menu_logo_dark ?? settings?.login_logo_dark ?? null,
          });
        }
      } catch {
        // The stock logo stays.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [customer?.customer_id]);

  useEffect(() => {
    if (!project?.project_id) {
      setProjectName(null);
      setAutoStages(null);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const token = await authService.ensureValidToken();
        const [details, settings] = await Promise.all([
          documentService.getProjectById(project.project_id, token),
          projectSettingService.getByProject(project.project_id, token),
        ]);
        if (cancelled) return;
        setProjectName(details?.project_name ?? null);
        setAutoStages(
          settings
            ? {
                process: settings.auto_process === 1,
                analyze: settings.auto_analyze === 1,
                ocr: settings.auto_ocr === 1,
              }
            : null,
        );
      } catch {
        // The sidebar simply shows the menu on its own.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [project?.project_id]);

  const [subMenuHeight, setSubMenuHeight] = useState<Record<string, number>>(
    {}
  );
  const subMenuRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Links are rendered with the customer prefix (/super/digitize) while
  // navItems store the bare path (/digitize), so an exact comparison never
  // matched once you were signed in — which is why the submenu collapsed on
  // selection and nothing was highlighted.
  const isActive = useCallback(
    (path: string) => {
      const current = location.pathname.replace(/\/$/, "") || "/";
      if (path === "/") return current === "/" || /^\/[^/]+$/.test(current);
      // Either the bare path, or it prefixed by a customer url, or a child of
      // it — so /verify/12 still lights up Verify. Both comparisons keep the
      // leading slash, which is what stops /assignments matching
      // /my-assignments.
      return current === path || current.endsWith(path) || current.includes(`${path}/`);
    },
    [location.pathname]
  );

  useEffect(() => {
    let submenuMatched = false;
    ["main", "others"].forEach((menuType) => {
      const items = menuType === "main" ? visibleNavItems : othersItems;
      items.forEach((nav, index) => {
        if (nav.subItems) {
          nav.subItems.forEach((subItem) => {
            if (isActive(subItem.path)) {
              setOpenSubmenu({
                type: menuType as "main" | "others",
                index,
              });
              submenuMatched = true;
            }
          });
        }
      });
    });

    if (!submenuMatched) {
      setOpenSubmenu(null);
    }
    // Every reason the list of visible groups can change has to be here.
    // The customer-level groups appear only once /user/me has answered, and
    // a customer administrator landing straight on Customer Settings had
    // Setup collapsed because this ran before that answer arrived — and
    // never again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location, isActive, membership.can_setup, account.is_customer_admin, project?.project_id]);

  useEffect(() => {
    if (openSubmenu !== null) {
      const key = `${openSubmenu.type}-${openSubmenu.index}`;
      if (subMenuRefs.current[key]) {
        setSubMenuHeight((prevHeights) => ({
          ...prevHeights,
          [key]: subMenuRefs.current[key]?.scrollHeight || 0,
        }));
      }
    }
  }, [openSubmenu]);

  const handleSubmenuToggle = (index: number, menuType: "main" | "others") => {
    setOpenSubmenu((prevOpenSubmenu) => {
      if (
        prevOpenSubmenu &&
        prevOpenSubmenu.type === menuType &&
        prevOpenSubmenu.index === index
      ) {
        return null;
      }
      return { type: menuType, index };
    });
  };

  const renderMenuItems = (items: NavItem[], menuType: "main" | "others") => (
    <ul className="flex flex-col gap-4">
      {items.map((nav, index) => {
        const frozen = !!nav.needsProject && noProject;
        return (
        <li key={nav.name}>
          {nav.subItems ? (
            <button
              onClick={() => handleSubmenuToggle(index, menuType)}
              disabled={frozen}
              title={frozen ? "Choose a project first" : undefined}
              // A group is never highlighted — the highlight marks where you
              // are, and you are never on a group. Open/closed is shown by the
              // chevron below.
              className={`menu-item group menu-item-inactive ${
                frozen ? "cursor-not-allowed opacity-40" : "cursor-pointer"
              } ${
                !isExpanded && !isHovered
                  ? "lg:justify-center"
                  : "lg:justify-start"
              }`}
            >
              <span className="menu-item-icon-size menu-item-icon-inactive">
                {nav.icon}
              </span>
              {(isExpanded || isHovered || isMobileOpen) && (
                <span className="menu-item-text">{nav.name}</span>
              )}
              {(isExpanded || isHovered || isMobileOpen) && (
                <ChevronDownIcon
                  className={`ml-auto w-5 h-5 transition-transform duration-200 ${
                    openSubmenu?.type === menuType &&
                    openSubmenu?.index === index
                      ? "rotate-180 text-brand-500"
                      : ""
                  }`}
                />
              )}
            </button>
          ) : frozen ? (
            <span
              title="Choose a project first"
              className={`menu-item group menu-item-inactive cursor-not-allowed opacity-40 ${
                !isExpanded && !isHovered ? "lg:justify-center" : "lg:justify-start"
              }`}
            >
              <span className="menu-item-icon-size menu-item-icon-inactive">{nav.icon}</span>
              {(isExpanded || isHovered || isMobileOpen) && (
                <span className="menu-item-text">{nav.name}</span>
              )}
            </span>
          ) : (
            nav.path && (
              <Link
                to={`${base}${nav.path}`}
                className={`menu-item group ${
                  isActive(nav.path) ? "menu-item-active" : "menu-item-inactive"
                }`}
              >
                <span
                  className={`menu-item-icon-size ${
                    isActive(nav.path)
                      ? "menu-item-icon-active"
                      : "menu-item-icon-inactive"
                  }`}
                >
                  {nav.icon}
                </span>
                {(isExpanded || isHovered || isMobileOpen) && (
                  <span className="menu-item-text">{nav.name}</span>
                )}
              </Link>
            )
          )}
          {nav.subItems && (isExpanded || isHovered || isMobileOpen) && (
            <div
              ref={(el) => {
                subMenuRefs.current[`${menuType}-${index}`] = el;
              }}
              className="overflow-hidden transition-all duration-300"
              style={{
                height:
                  openSubmenu?.type === menuType && openSubmenu?.index === index
                    ? `${subMenuHeight[`${menuType}-${index}`]}px`
                    : "0px",
              }}
            >
              <ul className="mt-2 space-y-1 ml-9">
                {nav.subItems.map((subItem) => (
                  <li key={subItem.name}>
                    <Link
                      to={`${base}${subItem.path}`}
                      className={`menu-dropdown-item ${
                        isActive(subItem.path)
                          ? "menu-dropdown-item-active"
                          : "menu-dropdown-item-inactive"
                      }`}
                    >
                      {subItem.name}
                      <span className="flex items-center gap-1 ml-auto">
                        {subItem.new && (
                          <span
                            className={`ml-auto ${
                              isActive(subItem.path)
                                ? "menu-dropdown-badge-active"
                                : "menu-dropdown-badge-inactive"
                            } menu-dropdown-badge`}
                          >
                            new
                          </span>
                        )}
                        {subItem.pro && (
                          <span
                            className={`ml-auto ${
                              isActive(subItem.path)
                                ? "menu-dropdown-badge-active"
                                : "menu-dropdown-badge-inactive"
                            } menu-dropdown-badge`}
                          >
                            pro
                          </span>
                        )}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </li>
        );
      })}
    </ul>
  );

  return (
    <aside
      className={`fixed mt-16 flex flex-col lg:mt-0 top-0 px-5 left-0 bg-white dark:bg-gray-900 dark:border-gray-800 text-gray-900 h-screen transition-all duration-300 ease-in-out z-50 border-r border-gray-200 
        ${
          isExpanded || isMobileOpen
            ? "w-[290px]"
            : isHovered
            ? "w-[290px]"
            : "w-[90px]"
        }
        ${isMobileOpen ? "translate-x-0" : "-translate-x-full"}
        lg:translate-x-0`}
      onMouseEnter={() => !isExpanded && setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        className={`flex py-2 ${
          !isExpanded && !isHovered ? "lg:justify-center" : "justify-start"
        }`}
      >
        <Link to="/" className={!isExpanded && !isHovered ? "" : "block w-full"}>
          {shownLogo ? (
            // The customer's own logo, set on Customer Settings. One image
            // for both themes — a customer supplies one, not a pair.
            // Given a box and told to fill it: `object-contain` keeps the
            // shape, so a wordmark stays wide and a squarish mark stays
            // square, but either one uses the whole space rather than sitting
            // small in the corner.
            <img
              src={shownLogo}
              alt={branding.label ?? "Logo"}
              // Width-driven: the rail's full width, with the height
              // following the picture's own shape. A fixed height meant a
              // 2:1 logo only ever reached halfway across, leaving the gap
              // that made it look stranded in the corner. Capped low so a
              // squarish logo cannot take over the top of the menu — the
              // menu is what the rail is for.
              className={`object-contain ${
                isExpanded || isHovered || isMobileOpen ? "h-auto w-full max-h-15" : "size-10"
              }`}
            />
          ) : (
            // Not the product's logo: a customer who has set none should see
            // a blank, not somebody else's branding.
            <LogoPlaceholder
              name={branding.label ?? customer?.customer_name}
              size={isExpanded || isHovered || isMobileOpen ? "md" : "sm"}
            />
          )}
        </Link>
      </div>
      {/* The project every screen below is about, with what its pipeline does
          for it: a lit icon means that stage runs by itself, a dim one means
          it never will. */}
      {(isExpanded || isHovered || isMobileOpen) && (
        <div className="-mx-5 mb-6 flex h-17 flex-col justify-center border-y border-gray-200 bg-gray-50 px-5 dark:border-gray-800 dark:bg-white/[0.03]">
          {/* The name of what is open — or that nothing is — with the way
              to choose beside it. The band is a fixed height either way,
              room for the name and the pipeline line beneath it, so the
              menu below does not jump when a project is chosen. */}
          <div className="flex items-center justify-between gap-2">
            {/* Whether a project is open is known at once; its name takes
                a request. Until it lands, hold the line's height rather
                than show the wrong state for a frame. */}
            {project?.project_id && !projectName ? (
              <span className="my-1 block h-4 w-32 animate-pulse rounded bg-gray-200 dark:bg-white/10" />
            ) : project?.project_id ? (
              <p className="truncate text-base font-semibold text-gray-800 dark:text-white/90">
                {projectName}
              </p>
            ) : (
              <p className="text-base font-semibold text-gray-400 dark:text-gray-500">
                No Project Selected
              </p>
            )}
            <Link
              to={`${base}/select-project`}
              title={project?.project_id ? "Change project" : "Select a project"}
              className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-brand-500/40 bg-brand-500/10 text-brand-500 transition hover:bg-brand-500 hover:text-white"
            >
              <FolderIcon className="size-4 fill-current" />
            </Link>
          </div>

          {autoStages && (
            <p className="mt-1 flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
              <span className="flex items-center gap-1">
                <svg
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className={`size-3.5 ${
                    autoStages.process ? "text-success-500" : "text-gray-300 dark:text-gray-600"
                  }`}
                >
                  <title>{autoStages.process ? "Auto enhance is on" : "Auto enhance is off"}</title>
                  <path d="m5 3 1.2 2.8L9 7 6.2 8.2 5 11 3.8 8.2 1 7l2.8-1.2zm9 2 2 4.5 4.5 2-4.5 2-2 4.5-2-4.5L7 11.5l4.5-2zM6 16l.9 2.1L9 19l-2.1.9L6 22l-.9-2.1L3 19l2.1-.9z" />
                </svg>
                Enhance
              </span>
              <span className="flex items-center gap-1">
                <svg
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className={`size-3.5 ${
                    autoStages.analyze ? "text-success-500" : "text-gray-300 dark:text-gray-600"
                  }`}
                >
                  <title>
                    {autoStages.analyze ? "Auto categorise is on" : "Auto categorise is off"}
                  </title>
                  <path d="M21.4 11.6 12.4 2.6A2 2 0 0 0 11 2H4a2 2 0 0 0-2 2v7a2 2 0 0 0 .6 1.4l9 9a2 2 0 0 0 2.8 0l7-7a2 2 0 0 0 0-2.8zM6.5 8A1.5 1.5 0 1 1 8 6.5 1.5 1.5 0 0 1 6.5 8z" />
                </svg>
                Categorise
              </span>
              <span className="flex items-center gap-1">
                {/* Lines of text on a page: what reading it produces. */}
                <svg
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className={`size-3.5 ${
                    autoStages.ocr ? "text-success-500" : "text-gray-300 dark:text-gray-600"
                  }`}
                >
                  <title>{autoStages.ocr ? "Auto OCR is on" : "Auto OCR is off"}</title>
                  <path d="M5 2h9l5 5v15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zm8 1.5V8h4.5zM7 11h10v1.6H7zm0 3.4h10V16H7zm0 3.4h6.5v1.6H7z" />
                </svg>
                OCR
              </span>
            </p>
          )}
        </div>
      )}

      <div className="flex flex-col flex-1 min-h-0 overflow-y-auto duration-300 ease-linear no-scrollbar">
        <nav className="mb-6">
          <div className="flex flex-col gap-4">
            <div>
              {/* No "Menu" heading: the items are self-evidently the menu,
                  and the project above them is what needed naming. The dots
                  stay for the collapsed rail, where they mark the group. */}
              {!isExpanded && !isHovered && !isMobileOpen && (
                <h2 className="mb-4 flex justify-center leading-[20px] text-gray-400">
                  <HorizontaLDots className="size-6" />
                </h2>
              )}
              {renderMenuItems(visibleNavItems, "main")}
            </div>
            <div className="">
              <h2
                className={`mb-4 text-xs uppercase flex leading-[20px] text-gray-400 ${
                  !isExpanded && !isHovered
                    ? "lg:justify-center"
                    : "justify-start"
                }`}
              >
                {isExpanded || isHovered || isMobileOpen ? (
                  "Others"
                ) : (
                  <HorizontaLDots />
                )}
              </h2>
              {renderMenuItems(othersItems, "others")}
            </div>
          </div>
        </nav>
      </div>
    </aside>
  );
};

export default AppSidebar;
