import { useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { qualify } from "../../services/usernameRules";
import { useCustomer } from "../../context/CustomerContext";
import { EyeCloseIcon, EyeIcon } from "../../icons";
import Label from "../form/Label";
import Input from "../form/input/InputField";
import Button from "../ui/button/Button";
import { customerService, CustomerDetails } from "../../services/customerService";
import { authService, PASSWORD_CHANGE_REQUIRED, EMAIL_VERIFICATION_REQUIRED } from "../../services/authService";
import { passwordLinkService } from "../../services/passwordLinkService";
import LogoPlaceholder from "../common/LogoPlaceholder";
import Toast from "../common/Toast";
import { useTheme } from "../../context/ThemeContext";

export default function SignInForm({
  // The customer this form signs in to, when it is not the one the
  // browser holds — somebody with a session open at /test visiting
  // /super. Its logo is shown and its access is checked; the stored
  // customer is switched only for the attempt and put back if the
  // password is wrong, so the open session is not disturbed.
  forCustomer,
}: {
  forCustomer?: CustomerDetails;
} = {}) {
  const { login, isLoading } = useAuth();
  const { customer: contextCustomer, setCustomer, getStoredCustomer } = useCustomer();
  const customer = forCustomer ?? contextCustomer;

  /**
   * What Keycloak holds for the name somebody typed.
   *
   * One realm serves every customer, so a username exists once across all of
   * them. Keycloak stores `acme.jsmith`; this form knows the customer from
   * the address bar and composes it. **Every call that names a person goes
   * through here** — signing in, forgotten passwords, the verification mail,
   * and setting a first password — because three of the four composing it
   * and one not is a bug nobody would find until somebody forgot a password.
   *
   * With no customer it returns what was typed. A system administrator signs
   * in on their own form, which has no customer and must not get a prefix.
   */
  const keycloakName = (typed: string) => qualify(customer?.customer_url, typed);

  // What this customer asks of a password, from the settings already
  // fetched for the logo on this very page. Shown before anybody types:
  // being refused after choosing twice is a poor way to learn the rules.
  const passwordRules = (() => {
    const settings = customer?.customer_id
      ? customerService.readCachedSettings(Number(customer.customer_id))
      : null;
    const minLength = Number(settings?.password_min_length ?? 8);
    const parts: string[] = [];
    if (settings?.password_needs_digit === 1) parts.push("a number");
    if (settings?.password_needs_capital === 1) parts.push("a capital letter");
    if (settings?.password_needs_symbol === 1) parts.push("a symbol");
    return {
      minLength,
      text:
        parts.length === 0
          ? `At least ${minLength} characters`
          : `At least ${minLength} characters, including ${parts.join(", ")}`,
    };
  })();

  // Sign in as the form's customer. Returns normally on success; throws
  // on failure with the stored customer restored.
  const signIn = async (username: string, password: string) => {
    const previous = forCustomer ? getStoredCustomer() : null;
    if (forCustomer) setCustomer(forCustomer);
    try {
      await login(keycloakName(username), password);
    } catch (err) {
      // The password step is not a failure — they carry on to it. Nor is
      // the verification step, where the customer stays chosen so the
      // address they come back to is the right one.
      const stepPending =
        err instanceof Error &&
        (err.name === PASSWORD_CHANGE_REQUIRED || err.name === EMAIL_VERIFICATION_REQUIRED);
      if (forCustomer && !stepPending) {
        setCustomer(previous);
      }
      throw err;
    }
  };
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // Set when a sign-in stopped because the address is unverified; holds the
  // username so the link can be sent again without asking for it twice.
  const [verifyEmailFor, setVerifyEmailFor] = useState<string | null>(null);
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent">("idle");
  // The forgotten-password panel, shown in place of the form. It is a panel
  // rather than its own page because /reset-password was a link to a route
  // that never existed.
  const [forgetting, setForgetting] = useState(false);
  const [forgotState, setForgotState] = useState<"idle" | "sending" | "sent">("idle");
  const [forgotMessage, setForgotMessage] = useState<string>("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  // The second step, shown only when Keycloak accepts the password but
  // wants it replaced — a temporary one set by an administrator. The
  // username and temporary password stay in state from the first step;
  // they go along as proof.
  const [choosingPassword, setChoosingPassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordAgain, setNewPasswordAgain] = useState("");
  const [settingPassword, setSettingPassword] = useState(false);
  // Whether this customer's people may sign in with their company login:
  // its alias when it is set up and on (the button), "unknown" when that
  // could not be checked (a line saying so), null otherwise (no button).
  const [companyAlias, setCompanyAlias] = useState<string | null>(null);
  const [companyUnknown, setCompanyUnknown] = useState(false);
  const [companySigningIn, setCompanySigningIn] = useState(false);

  /**
   * The company-login button: the tab goes to the customer's own login and
   * comes back signed in (`authService.finishCompanySignIn`). The customer
   * travels with it — the form's own one when it is for another customer
   * than the open session's — and is only kept if the person turns out to
   * be theirs.
   */
  const signInWithCompany = async () => {
    if (!companyAlias || !customer?.customer_id) return;
    setFormError(null);
    setCompanySigningIn(true);
    try {
      await authService.startCompanySignIn(companyAlias, customer);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not reach the company login");
      setCompanySigningIn(false);
    }
  };

  // The customer's own logo and name for itself, when they have set them.
  // From the public answer, since nobody is signed in yet.
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
        : null;
        // Either logo will do: a customer who sets one and not the other
      // should see it everywhere rather than a placeholder on half the
      // screens.
      return {
        label: cached?.customer_label ?? null,
        logo: cached?.login_logo ?? cached?.menu_logo ?? null,
        logoDark: cached?.login_logo_dark ?? cached?.menu_logo_dark ?? null,
      };
    },
  );

  // Which mark to draw. Falls back to the light one: most logos read on
  // either background, and a customer who set only the one should see it
  // rather than nothing.
  const { theme } = useTheme();
  const shownLogo = theme === "dark" ? branding.logoDark || branding.logo : branding.logo;

  // Nobody is signed in here, so this reads the public answer — the same
  // cached request the page made to find the customer — and keeps its logos
  // and password rules where `passwordRules` above and the later screens
  // look for them.
  useEffect(() => {
    if (!customer?.customer_id || !customer.customer_url) return;
    let cancelled = false;

    (async () => {
      try {
        const { data } = await customerService.getCustomerByUrl(customer.customer_url);
        if (cancelled) return;
        const current = customerService.readCachedSettings(customer.customer_id);
        customerService.writeCachedSettings(customer.customer_id, {
          ...current,
          customer_label: data.customer_label,
          login_logo: data.login_logo,
          menu_logo: data.menu_logo,
          login_logo_dark: data.login_logo_dark,
          menu_logo_dark: data.menu_logo_dark,
          ...(data.password_min_length !== null ? { password_min_length: data.password_min_length } : {}),
          ...(data.password_needs_digit !== null ? { password_needs_digit: data.password_needs_digit } : {}),
          ...(data.password_needs_symbol !== null ? { password_needs_symbol: data.password_needs_symbol } : {}),
          ...(data.password_needs_capital !== null ? { password_needs_capital: data.password_needs_capital } : {}),
        });
        setBranding({
          label: data.customer_label,
          logo: data.login_logo ?? data.menu_logo,
          logoDark: data.login_logo_dark ?? data.menu_logo_dark,
        });
        setCompanyAlias(data.company_login);
        setCompanyUnknown(data.company_login_unknown);
      } catch {
        // The customer's name on its own is a fine sign-in page.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [customer?.customer_id, customer?.customer_url]);
  return (
    <div className="flex flex-col flex-1">
      <div className="flex flex-col justify-center flex-1 w-full max-w-md mx-auto">
        <div>
          <div className="mb-5 text-center sm:mb-8">
            <div className="mb-4 flex justify-center">
              {shownLogo ? (
                <img src={shownLogo} alt="" className="h-20 w-full object-contain" />
              ) : (
                <LogoPlaceholder name={branding.label ?? customer?.customer_name} />
              )}
            </div>
            {/* Only what the customer chose to be called. With no label set
                the page carries the logo alone rather than the record's
                internal name. */}
            {branding.label && (
              <h1 className="font-semibold text-gray-800 text-title-sm dark:text-white/90 sm:text-title-md">
                {branding.label}
              </h1>
            )}
          </div>
          <div>
            {/* One toast for both steps, top centre like every message in
                the app. The context's own `error` is the same text, so it
                is not shown twice. */}
            {formError && <Toast message={formError} type="error" onClose={() => setFormError(null)} />}
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setFormError(null);
                try {
                  await signIn(username, password);
                  // Stay at the same URL, page will refresh and show dashboard
                  window.location.reload();
                } catch (err) {
                  if (err instanceof Error && err.name === PASSWORD_CHANGE_REQUIRED) {
                    setChoosingPassword(true);
                    return;
                  }
                  if (err instanceof Error && err.name === EMAIL_VERIFICATION_REQUIRED) {
                    // Nothing to do on this screen: the link is in their
                    // inbox. Offer to send it again, since the usual reason
                    // somebody is here is that it never arrived.
                    setVerifyEmailFor(username);
                    return;
                  }
                  const message =
                    err instanceof Error ? err.message : "Login failed";
                  setFormError(message);
                }
              }}
            >
              {forgetting ? (
              <div className="space-y-5">
                <div className="p-3 rounded-lg bg-brand-50 dark:bg-brand-500/10">
                  <p className="text-sm text-gray-700 dark:text-gray-300">
                    Enter your username and we will email you a link to set a new password.
                  </p>
                </div>
                <div>
                  <Label>
                    Username <span className="text-error-500">*</span>
                  </Label>
                  <Input
                    placeholder="Your username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </div>
                {forgotState === "sent" && (
                  <p className="text-sm text-gray-700 dark:text-gray-300">{forgotMessage}</p>
                )}
                <Button
                  type="button"
                  className="w-full"
                  size="sm"
                  disabled={!username.trim() || forgotState === "sending"}
                  onClick={async () => {
                    setFormError(null);
                    setForgotState("sending");
                    try {
                      // **smartdoc_api, not auth_api.** The link has to
                      // land on a SmartDoc page to apply this customer's
                      // password rules, and only smartdoc_api can sign one.
                      // The username goes as typed, with the customer
                      // beside it: the server composes the stored form, so
                      // the browser never decides it.
                      const answer = await passwordLinkService.request(
                        username,
                        customer?.customer_url ?? ""
                      );
                      setForgotMessage(answer);
                      setForgotState("sent");
                    } catch (err) {
                      setForgotState("idle");
                      setFormError(err instanceof Error ? err.message : "Could not send the email");
                    }
                  }}
                >
                  {forgotState === "sending" ? "Sending..." : "Email me a link"}
                </Button>
                <button
                  type="button"
                  className="text-sm text-brand-500 hover:text-brand-600"
                  onClick={() => {
                    setForgetting(false);
                    setForgotState("idle");
                  }}
                >
                  Back to sign in
                </button>
              </div>
              ) : verifyEmailFor ? (
              <div className="space-y-5">
                <div className="p-3 rounded-lg bg-brand-50 dark:bg-brand-500/10">
                  <p className="text-sm text-gray-700 dark:text-gray-300">
                    Check your email and follow the link to verify your address.
                    You can sign in once that is done.
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Button
                    type="button"
                    className="w-full"
                    size="sm"
                    disabled={resendState === "sending"}
                    onClick={async () => {
                      setFormError(null);
                      setResendState("sending");
                      try {
                        // The same one door. The server works out that
                        // this account needs the invitation — the link that
                        // proves the address and sets a first password —
                        // rather than this form deciding.
                        await passwordLinkService.request(
                          verifyEmailFor,
                          customer?.customer_url ?? ""
                        );
                        setResendState("sent");
                      } catch (err) {
                        setResendState("idle");
                        setFormError(err instanceof Error ? err.message : "Could not send the email");
                      }
                    }}
                  >
                    {resendState === "sending"
                      ? "Sending..."
                      : resendState === "sent"
                        ? "Sent — check your inbox"
                        : "Send the link again"}
                  </Button>
                </div>
                <button
                  type="button"
                  className="text-sm text-brand-500 hover:text-brand-600"
                  onClick={() => {
                    setVerifyEmailFor(null);
                    setResendState("idle");
                  }}
                >
                  Back to sign in
                </button>
              </div>
              ) : choosingPassword ? (
              <div className="space-y-6">
                <div className="p-3 rounded-lg bg-brand-50 dark:bg-brand-500/10">
                  <p className="text-sm text-gray-700 dark:text-gray-300">
                    The password you used is a temporary one. Choose your own to finish signing in.
                  </p>
                </div>
                <div>
                  <Label>
                    New password <span className="text-error-500">*</span>
                  </Label>
                  <Input
                    type="password"
                    placeholder={passwordRules.text}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                  <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                    {passwordRules.text}.
                  </p>
                </div>
                <div>
                  <Label>
                    New password again <span className="text-error-500">*</span>
                  </Label>
                  <Input
                    type="password"
                    placeholder="The same once more"
                    value={newPasswordAgain}
                    onChange={(e) => setNewPasswordAgain(e.target.value)}
                  />
                </div>
                <div>
                  <Button
                    className="w-full"
                    size="sm"
                    type="button"
                    disabled={
                      settingPassword ||
                      isLoading ||
                      newPassword.length < passwordRules.minLength ||
                      newPassword !== newPasswordAgain
                    }
                    onClick={async () => {
                      setFormError(null);
                      setSettingPassword(true);
                      try {
                        await authService.completePassword(keycloakName(username), password, newPassword);
                        // The password is set; now the ordinary sign-in,
                        // which also checks they belong to this customer.
                        await signIn(username, newPassword);
                        window.location.reload();
                      } catch (err) {
                        // The password was set but the address is still
                        // unverified. Not an error to show in red: say what
                        // is left instead, on the panel that can resend the
                        // link.
                        if (err instanceof Error && err.name === EMAIL_VERIFICATION_REQUIRED) {
                          setChoosingPassword(false);
                          setVerifyEmailFor(username);
                          return;
                        }
                        setFormError(
                          err instanceof Error ? err.message : "Could not set the new password",
                        );
                      } finally {
                        setSettingPassword(false);
                      }
                    }}
                  >
                    {settingPassword || isLoading ? "Signing in..." : "Set password and sign in"}
                  </Button>
                  {newPassword.length > 0 && newPasswordAgain && newPassword !== newPasswordAgain && (
                    <p className="mt-2 text-sm text-error-600 dark:text-error-400">
                      The two passwords are not the same.
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setChoosingPassword(false);
                    setNewPassword("");
                    setNewPasswordAgain("");
                    setFormError(null);
                  }}
                  className="text-sm text-brand-500 hover:text-brand-600 dark:text-brand-400"
                >
                  Back to sign in
                </button>
              </div>
              ) : (
              <div className="space-y-6">
                {/* **Above the form, because it is how most of this
                    customer's people get in.** The form stays for anybody
                    on a personal address, who has a SmartDoc password. */}
                {companyAlias && (
                  <div className="space-y-4">
                    <Button
                      type="button"
                      className="w-full"
                      size="sm"
                      disabled={companySigningIn || isLoading}
                      onClick={signInWithCompany}
                    >
                      {companySigningIn ? "Signing in..." : "Sign in with your company login"}
                    </Button>
                    <div className="flex items-center gap-3 text-xs text-gray-400">
                      <span className="h-px flex-1 bg-gray-200 dark:bg-gray-800" />
                      or with a SmartDoc password
                      <span className="h-px flex-1 bg-gray-200 dark:bg-gray-800" />
                    </div>
                  </div>
                )}
                {/* Said rather than hidden: somebody who signs in with their
                    company login would otherwise stare at a password form
                    and wonder which password. */}
                {companyUnknown && (
                  <p className="rounded-lg bg-warning-50 p-3 text-sm text-warning-700 dark:bg-warning-500/10 dark:text-warning-400">
                    Signing in with your company login is not available right now. If you have a
                    SmartDoc password you can use it below; otherwise try again in a few minutes.
                  </p>
                )}
                <div>
                  <Label>
                    Username <span className="text-error-500">*</span>{" "}
                  </Label>
                  <Input
                    placeholder="your username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </div>
                <div>
                  <Label>
                    Password <span className="text-error-500">*</span>{" "}
                  </Label>
                  <div className="relative">
                    <Input
                      type={showPassword ? "text" : "password"}
                      placeholder="Enter your password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <span
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute z-30 -translate-y-1/2 cursor-pointer right-4 top-1/2"
                    >
                      {showPassword ? (
                        <EyeIcon className="fill-gray-500 dark:fill-gray-400 size-5" />
                      ) : (
                        <EyeCloseIcon className="fill-gray-500 dark:fill-gray-400 size-5" />
                      )}
                    </span>
                  </div>
                </div>
                {/* "Keep me logged in" stood here, from the template, and did
                    nothing: how long a session lasts is the customer's idle
                    timeout (bug #8). */}
                <div className="flex items-center justify-end">
                  <button
                    type="button"
                    className="text-sm text-brand-500 hover:text-brand-600 dark:text-brand-400"
                    onClick={() => {
                      setFormError(null);
                      setForgotState("idle");
                      setForgetting(true);
                    }}
                  >
                    Forgot password?
                  </button>
                </div>
                <div>
                  <Button
                    className="w-full"
                    size="sm"
                    disabled={isLoading}
                    type="submit"
                  >
                    {isLoading ? "Signing in..." : "Sign in"}
                  </Button>
                </div>
              </div>
              )}
            </form>

          </div>
        </div>
      </div>
    </div>
  );
}
