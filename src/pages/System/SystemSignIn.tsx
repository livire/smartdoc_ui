import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router";
import PageMeta from "../../components/common/PageMeta";
import AuthLayout from "../AuthPages/AuthPageLayout";
import Label from "../../components/form/Label";
import Input from "../../components/form/input/InputField";
import Button from "../../components/ui/button/Button";
import { EyeCloseIcon, EyeIcon } from "../../icons";
import { useAuth } from "../../context/AuthContext";
import { useCustomer } from "../../context/CustomerContext";
import { authService } from "../../services/authService";
import Toast from "../../components/common/Toast";

/**
 * Signing in to SmartDoc itself, rather than to a customer.
 *
 * Everyone else arrives at `/<their customer>`, and the screen is branded
 * with that customer's logo. This one is not a customer's: whoever signs in
 * here creates customers and each customer's first administrator. Their
 * account exists in Keycloak only — no row in `user`, no projects — and the
 * token says what they may do.
 */
export default function SystemSignIn() {
  const navigate = useNavigate();
  const { login, logout, isLoading, isAuthenticated } = useAuth();
  const { clearCustomer } = useCustomer();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Nothing here belongs to a customer. Any left over from a previous visit
  // would make the sign-in check the account against a customer it has
  // nothing to do with.
  useEffect(() => {
    document.title = "SmartDoc | System Admin";
    clearCustomer();
    localStorage.removeItem("selected_project");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Only a confirmed system session goes straight through; anyone else
  // gets the form, whatever tokens are lying about.
  if (isAuthenticated && localStorage.getItem("smartdoc.system_session") === "1") {
    return <Navigate to="/sys/customers" replace />;
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!username.trim() || !password) {
      setFormError("Enter a username and password");
      return;
    }

    try {
      await login(username.trim(), password);

      // The password being right does not make this a system account. Ask
      // the server before going anywhere: a customer's own user signing in
      // here used to be let through, land on the customer list, and be
      // thrown out again a second later — the screen had decided before it
      // had the answer.
      const token = authService.getStoredToken();
      const me = token
        ? await authService.getMe(token)
        : { is_sysadmin: false };

      if (!me.is_sysadmin) {
        logout();
        setFormError(
          "That account is not a system account. Sign in at your organisation's SmartDoc address instead.",
        );
        return;
      }

      // Only now, and only because the server said so: signing out later
      // comes back here rather than to whichever customer was being looked
      // at, and the first render of the next screen can trust it.
      try {
        localStorage.setItem("smartdoc.system_session", "1");
      } catch {
        // Without it, sign-out lands on the customer's page. Harmless.
      }
      navigate("/sys/customers");
    } catch {
      // AuthContext puts the reason in `error`.
    }
  };

  return (
    <>
      <PageMeta title="SmartDoc | System Admin" description="Sign in to SmartDoc" />
      <AuthLayout>
        <div className="flex flex-1 flex-col justify-center">
          <div className="mx-auto w-full max-w-md">
            <h1 className="mb-6 text-2xl font-semibold text-gray-800 dark:text-white/90">
              SmartDoc <span className="font-normal text-gray-300 dark:text-gray-600">|</span>{" "}
              System Admin
            </h1>

            <form onSubmit={submit} className="space-y-4">
              <div>
                <Label htmlFor="sys-username">Admin Username</Label>
                <Input
                  id="sys-username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="username"
                />
              </div>

              <div>
                <Label htmlFor="sys-password">Password</Label>
                <div className="relative">
                  <Input
                    id="sys-password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="password"
                  />
                  <span
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 z-30 -translate-y-1/2 cursor-pointer"
                  >
                    {showPassword ? (
                      <EyeIcon className="size-5 fill-gray-500 dark:fill-gray-400" />
                    ) : (
                      <EyeCloseIcon className="size-5 fill-gray-500 dark:fill-gray-400" />
                    )}
                  </span>
                </div>
              </div>

              {formError && <Toast message={formError} type="error" onClose={() => setFormError(null)} />}

              {/* type="submit": the shared Button defaults to "button", so
                  without this the form never submits and the click does
                  nothing at all. */}
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? "Signing in..." : "Sign in"}
              </Button>
            </form>
          </div>
        </div>
      </AuthLayout>
    </>
  );
}
