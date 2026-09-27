import PageMeta from "../components/common/PageMeta";
import { useAuth } from "../context/AuthContext";

export default function Workspace() {
  const { user } = useAuth();

  return (
    <>
      <PageMeta
        title="My Workspace | SmartDoc"
        description="My Workspace page"
      />
      <div className="mx-auto max-w-screen-2xl p-4 md:p-6 2xl:p-10">
        <div className="mb-6">
          <h1 className="text-title-md2 font-bold text-gray-800 dark:text-white">
            My Workspace
          </h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            Welcome to your workspace, {user?.given_name}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-800">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                Workspace Overview
              </h3>
              <div className="rounded-full bg-brand-100 p-3 dark:bg-brand-900/20">
                <svg
                  className="h-6 w-6 text-brand-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                  />
                </svg>
              </div>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Manage and organize your workspace items and projects.
            </p>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-800">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                Recent Items
              </h3>
              <div className="rounded-full bg-green-100 p-3 dark:bg-green-900/20">
                <svg
                  className="h-6 w-6 text-green-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                  />
                </svg>
              </div>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              View and access your recently used files and documents.
            </p>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-800">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                Settings
              </h3>
              <div className="rounded-full bg-purple-100 p-3 dark:bg-purple-900/20">
                <svg
                  className="h-6 w-6 text-purple-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
              </div>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Configure your workspace preferences and settings.
            </p>
          </div>
        </div>

        <div className="mt-8 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-800">
          <h2 className="mb-4 text-title-sm font-bold text-gray-900 dark:text-white">
            User Information
          </h2>
          <div className="space-y-3">
            <div className="flex justify-between border-b border-gray-200 pb-3 dark:border-gray-700">
              <span className="text-sm text-gray-600 dark:text-gray-400">
                Name:
              </span>
              <span className="font-medium text-gray-900 dark:text-white">
                {user?.name || "N/A"}
              </span>
            </div>
            <div className="flex justify-between border-b border-gray-200 pb-3 dark:border-gray-700">
              <span className="text-sm text-gray-600 dark:text-gray-400">
                Email:
              </span>
              <span className="font-medium text-gray-900 dark:text-white">
                {user?.email || "N/A"}
              </span>
            </div>
            <div className="flex justify-between border-b border-gray-200 pb-3 dark:border-gray-700">
              <span className="text-sm text-gray-600 dark:text-gray-400">
                Username:
              </span>
              <span className="font-medium text-gray-900 dark:text-white">
                {user?.preferred_username || "N/A"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-600 dark:text-gray-400">
                Email Verified:
              </span>
              <span className="font-medium">
                {user?.email_verified ? (
                  <span className="text-green-600 dark:text-green-400">Yes</span>
                ) : (
                  <span className="text-red-600 dark:text-red-400">No</span>
                )}
              </span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
