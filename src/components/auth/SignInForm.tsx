import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useAuth } from "../../context/AuthContext";
import { useCustomer } from "../../context/CustomerContext";
import { EyeCloseIcon, EyeIcon } from "../../icons";
import Label from "../form/Label";
import Input from "../form/input/InputField";
import Checkbox from "../form/input/Checkbox";
import Button from "../ui/button/Button";
import { customerService, CustomerDetails } from "../../services/customerService";
import { authService, PASSWORD_CHANGE_REQUIRED, EMAIL_VERIFICATION_REQUIRED } from "../../services/authService";
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
      await login(username, password);
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
  const [isChecked, setIsChecked] = useState(false);
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
  // The customer's own logo and name for itself, when they have set them.
  // Read with the service token, since nobody has one of their own yet.
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

  useEffect(() => {
    if (!customer?.customer_id) return;
    let cancelled = false;

    (async () => {
      try {
        const settings = await customerService.getSettings(customer.customer_id);
        if (!cancelled) {
          setBranding({
            label: settings?.customer_label ?? null,
            logo: settings?.login_logo ?? settings?.menu_logo ?? null,
            logoDark: settings?.login_logo_dark ?? settings?.menu_logo_dark ?? null,
          });
        }
      } catch {
        // The customer's name on its own is a fine sign-in page.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [customer?.customer_id]);
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
                      const answer = await authService.forgotPassword(username.trim());
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
                        await authService.resendVerification(verifyEmailFor);
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
                        await authService.completePassword(username, password, newPassword);
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
                  {newPassword.length >= 8 && newPasswordAgain && newPassword !== newPasswordAgain && (
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
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Checkbox checked={isChecked} onChange={setIsChecked} />
                    <span className="block font-normal text-gray-700 text-theme-sm dark:text-gray-400">
                      Keep me logged in
                    </span>
                  </div>
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

            <div className="mt-5">
              <p className="text-sm font-normal text-center text-gray-700 dark:text-gray-400 sm:text-start">
                Don&apos;t have an account? {""}
                <Link
                  to="/signup"
                  className="text-brand-500 hover:text-brand-600 dark:text-brand-400"
                >
                  Sign Up
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
