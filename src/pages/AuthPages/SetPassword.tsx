import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import PageMeta from "../../components/common/PageMeta";
import AuthLayout from "./AuthPageLayout";
import Button from "../../components/ui/button/Button";
import Label from "../../components/form/Label";
import Input from "../../components/form/input/InputField";
import { useAuth } from "../../context/AuthContext";
import { useCustomer } from "../../context/CustomerContext";
import { customerService } from "../../services/customerService";
import {
  passwordLinkService,
  checkAgainst,
  LinkFacts,
} from "../../services/passwordLinkService";

/**
 * Choosing a password from an emailed link.
 *
 * **Why this page exists.** A customer can ask for 12 characters and a
 * symbol. Those rules are SmartDoc's, in `customer_setting` — Keycloak has
 * one policy for the whole realm and knows nothing about them. So anybody
 * who arrived from a Keycloak email set their password on a Keycloak page
 * with 8 characters enforced, however the customer had it configured. The
 * link now lands here instead, and this page knows the customer from the
 * address bar.
 *
 * **The token is in the `#` of the address, not the path.** Everything after
 * a `#` stays in the browser: it is never sent to a server, so it cannot end
 * up in `smartdoc_api`'s log (which records every request URL) or in a
 * `Referer` header on the way to some other site. It is read out of
 * `location.hash` here and sent in a request body.
 *
 * **Nobody is signed in while this page is open**, which is the whole point
 * — the person cannot sign in yet. The link is what authorises it.
 */
export default function SetPassword() {
  const { customerUrl } = useParams<{ customerUrl: string }>();
  const navigate = useNavigate();
  const { login } = useAuth();
  const { setCustomer } = useCustomer();

  // Read once, before anything can change the address. React Router leaves
  // the hash alone, but a navigation inside the app would drop it.
  const [token] = useState(() => window.location.hash.replace(/^#/, ""));

  const [facts, setFacts] = useState<LinkFacts | null>(null);
  const [loading, setLoading] = useState(true);
  // Why the link is no good, as the server put it. One message for expired,
  // already used and tampered with: they are the same thing to whoever is
  // reading it — ask for a new one.
  const [refused, setRefused] = useState<string | null>(null);

  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    if (!token) {
      setRefused("That link is incomplete. Ask for a new one from the sign-in page.");
      setLoading(false);
      return;
    }

    passwordLinkService
      .check(token)
      .then((answer) => {
        if (!alive) return;
        setFacts(answer);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setRefused(err instanceof Error ? err.message : "That link is no longer valid");
        setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [token]);

  // The customer's own logo, the same as the sign-in page shows. Fetched
  // separately because the link's own answer deliberately carries as little
  // as possible about the account.
  const [logo, setLogo] = useState<string | null>(null);
  useEffect(() => {
    if (!customerUrl) return;
    let alive = true;
    customerService
      .getCustomerByUrl(customerUrl)
      .then((response) => {
        const row = response?.data;
        if (alive && row?.customer_id) setLogo(row.login_logo || null);
      })
      .catch(() => {
        // A missing logo is not worth a message on this page.
      });
    return () => {
      alive = false;
    };
  }, [customerUrl]);

  const rules = facts ? checkAgainst(password, facts.rules) : [];
  const allMet = rules.every((rule) => rule.met);
  const matches = password.length > 0 && password === again;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!facts || !allMet || !matches) return;

    setSaving(true);
    setError(null);
    try {
      const done = await passwordLinkService.complete(token, password);

      // Straight in, rather than back to a sign-in form to type what they
      // have just chosen. The stored username is what Keycloak holds —
      // `acme.jsmith` — which is what the direct grant needs; the short form
      // is only for reading.
      try {
        const row = await customerService.getCustomerByUrl(done.customer_url);
        if (row?.data) setCustomer(customerService.withoutBranding(row.data));
        await login(done.username, password);
        navigate(`/${done.customer_url}`, { replace: true });
        return;
      } catch {
        // The password is set — that already happened on the server. Only
        // the sign-in failed, so send them to the form rather than
        // reporting a failure that would make them ask for another link.
        navigate(`/${done.customer_url}`, { replace: true });
        return;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not set the password");
      setSaving(false);
    }
  };

  const heading = facts?.purpose === "invite" ? "Choose your password" : "Set a new password";

  return (
    <>
      <PageMeta title="Set your password | SmartDoc" description="" />
      <AuthLayout>
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 pt-10 sm:pt-16">
          {logo && (
            <div className="mb-6 flex justify-center">
              <img src={logo} alt="" className="h-12 w-auto object-contain" />
            </div>
          )}

          {loading ? (
            <p className="text-center text-sm text-gray-400">Checking the link...</p>
          ) : refused ? (
            <div className="space-y-5 text-center">
              <h1 className="text-title-sm font-semibold text-gray-800 dark:text-white/90">
                This link cannot be used
              </h1>
              <p className="text-sm text-gray-600 dark:text-gray-400">{refused}</p>
              <Link
                to={`/${customerUrl ?? ""}`}
                className="inline-block text-sm text-brand-500 hover:text-brand-600"
              >
                Back to sign in
              </Link>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-5">
              <div>
                <h1 className="text-lg font-semibold text-gray-800 dark:text-white/90">
                  {heading}
                </h1>
              </div>

              {/* **The username, as a field they cannot change.** It was a
                  sentence under the heading — "For faisal at POPO" — which
                  reads as decoration. This is the account the password is
                  about to belong to, and it is the thing to check before
                  typing. */}
              <div>
                <Label htmlFor="set-password-username">Username</Label>
                <Input
                  id="set-password-username"
                  value={facts?.username ?? ""}
                  disabled
                  onChange={() => {}}
                />
              </div>

              <div>
                <Label htmlFor="new-password">New password *</Label>
                <div className="relative">
                  <Input
                    id="new-password"
                    type={show ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Choose a password"
                  />
                  <button
                    type="button"
                    onClick={() => setShow((on) => !on)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400"
                  >
                    {show ? "Hide" : "Show"}
                  </button>
                </div>
              </div>

              <div>
                <Label htmlFor="new-password-again">Again *</Label>
                <Input
                  id="new-password-again"
                  type={show ? "text" : "password"}
                  value={again}
                  onChange={(e) => setAgain(e.target.value)}
                  placeholder="The same password"
                />
                {again.length > 0 && !matches && (
                  <p className="mt-1 text-xs text-error-500">Those two do not match.</p>
                )}
              </div>

              {/* **This customer's rules, ticking off as they are met.** The
                  whole reason the link comes here rather than to Keycloak:
                  that page could only enforce the realm's 8 characters. */}
              {/* One line, wrapping if it must: four rules stacked took
                  more of the page than the fields they describe. */}
              <ul className="flex flex-wrap gap-x-3 gap-y-1 rounded-lg bg-gray-50 px-3 py-2 dark:bg-white/[0.03]">
                {rules.map((rule) => (
                  <li
                    key={rule.text}
                    className={`flex items-center gap-1 text-xs ${
                      rule.met
                        ? "text-success-600 dark:text-success-500"
                        : "text-gray-500 dark:text-gray-400"
                    }`}
                  >
                    <span>{rule.met ? "✓" : "•"}</span>
                    {rule.text}
                  </li>
                ))}
              </ul>

              {error && (
                <p className="rounded-lg bg-error-50 p-3 text-sm text-error-600 dark:bg-error-500/10 dark:text-error-500">
                  {error}
                </p>
              )}

              <Button
                type="submit"
                className="w-full"
                size="sm"
                disabled={saving || !allMet || !matches}
              >
                {saving ? "Setting it..." : "Set password and sign in"}
              </Button>
            </form>
          )}
        </div>
      </AuthLayout>
    </>
  );
}
