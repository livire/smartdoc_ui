import { useCallback, useEffect, useState } from "react";
import PageMeta from "../../components/common/PageMeta";
import Toast from "../../components/common/Toast";
import { systemSettingsService, SignInSettings } from "../../services/systemSettingsService";

/**
 * How somebody may sign in.
 *
 * **Three flags on the Keycloak realm**, not rows in our database — one
 * source of truth, and nothing to keep in step. Until now they were changed
 * by hand in the Keycloak console, which meant knowing it existed and
 * knowing which of its hundred-odd realm fields to touch.
 *
 * **Whoever runs SmartDoc, not a customer.** There is one realm for every
 * customer, so a change here is a change for all of them. That is why this
 * is on `/sys` and not on Customer Settings.
 */
const FLAGS: { id: keyof SignInSettings; label: string; what: string; careful?: string }[] = [
  {
    id: "loginWithEmailAllowed",
    label: "Sign in with an email address",
    what: "Somebody may type their email instead of their username",
    careful:
      "With this on, an email address may belong to only one account across every customer.",
  },
  {
    id: "resetPasswordAllowed",
    label: "Forgot password",
    what: "Somebody may ask for a link to set a new password",
    careful:
      "Off, the sign-in form still offers it but the request is refused, with a line telling them to ask an administrator.",
  },
  {
    id: "verifyEmail",
    label: "Verify email",
    what: "A new account must follow a link before it can sign in",
    careful:
      "Everybody whose address is unverified is asked at their next sign-in, not only new accounts.",
  },
];

export default function SystemSignInSettings() {
  const [settings, setSettings] = useState<SignInSettings | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const load = useCallback(async () => {
    try {
      setSettings(await systemSettingsService.signIn());
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : "Could not load", type: "error" });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = async (id: keyof SignInSettings, on: boolean) => {
    setSaving(id);
    try {
      setSettings(await systemSettingsService.setSignIn({ [id]: on }));
      setToast({ message: "Saved", type: "success" });
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : "Could not save", type: "error" });
    } finally {
      setSaving(null);
    }
  };

  return (
    // The same frame as the other system screens: `SystemLayout` gives them
    // no padding and no background of their own, so each supplies both.
    <div className="flex min-h-0 flex-1 flex-col overflow-auto bg-gray-50 p-4 dark:bg-gray-900">
      <PageMeta title="Sign-in | SmartDoc System" description="How people sign in to SmartDoc" />

      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
        <h3 className="mb-1 text-base font-semibold text-gray-800 dark:text-white/90">Sign-in</h3>
        <p className="mb-5 text-sm text-gray-500 dark:text-gray-400">
          These apply to every customer — there is one Keycloak realm behind all of them.
        </p>

        {!settings && <p className="py-6 text-center text-sm text-gray-400">Loading...</p>}

        {settings && (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {FLAGS.map((flag) => (
              <li key={flag.id} className="flex items-start gap-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-800 dark:text-white/90">
                    {flag.label}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{flag.what}</p>
                  {/* Shown in the state it describes — a warning about a
                      switch nobody has flipped is one people learn to skip.
                      Forgot password's warning is about being off; the
                      other two are about being on. */}
                  {flag.careful &&
                    (flag.id === "resetPasswordAllowed"
                      ? !settings[flag.id]
                      : settings[flag.id]) && (
                      <p className="mt-1 text-xs text-warning-600 dark:text-warning-500">
                        {flag.careful}
                      </p>
                    )}
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={settings[flag.id]}
                  aria-label={flag.label}
                  disabled={saving === flag.id}
                  onClick={() => toggle(flag.id, !settings[flag.id])}
                  className={`relative mt-0.5 h-5 w-9 flex-shrink-0 rounded-full transition-colors duration-200 ${
                    settings[flag.id] ? "bg-brand-500" : "bg-gray-300 dark:bg-gray-700"
                  } ${saving === flag.id ? "opacity-50" : "cursor-pointer"}`}
                >
                  <span
                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-[left] duration-200 ${
                      settings[flag.id] ? "left-[18px]" : "left-0.5"
                    }`}
                  />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}
    </div>
  );
}
