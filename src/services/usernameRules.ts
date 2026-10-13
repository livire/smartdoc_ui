/**
 * Usernames that belong to a customer.
 *
 * **The problem.** There is one Keycloak realm for the whole system, so a
 * username exists once across every customer: two companies cannot both
 * employ a `jsmith`.
 *
 * **The answer.** Keycloak stores `acme.jsmith`; the person types `jsmith`.
 * This form already knows the customer from the address bar, so it composes
 * the name before sending it, and the Users screen shows the part after the
 * prefix.
 *
 * **A copy, deliberately**, like `authService` — of
 * `smartdoc_api/service/usernameRules.js`, which has the tests
 * (`npm test` there). The staff app and the viewer are deployed separately
 * and a shared package between them has to be versioned and released before
 * either can change. **If you fix something here, fix it in all three.** The
 * two forms composing differently would mean signing in works in one app and
 * not the other.
 */

const SEPARATOR = ".";

/**
 * The prefix for a customer, from its `customer_url`.
 *
 * Anything that is not a letter, digit or hyphen is dropped: a separator
 * inside the prefix would make the boundary ambiguous, and `strip` could
 * then take the wrong piece off.
 */
export function prefixFor(customerUrl?: string | null): string {
  if (!customerUrl) return "";
  return String(customerUrl).trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
}

/**
 * What to send to Keycloak for somebody typing `typed` at `customerUrl`.
 *
 * **Idempotent**, so somebody who types their full stored name — because
 * they saw it on the Users screen, or the browser filled it in — gets the
 * same answer as somebody typing the short one.
 *
 * **No customer means no prefix.** A system administrator signs in at `/sys`
 * with no customer at all, and their account is not a customer's.
 */
export function qualify(customerUrl: string | null | undefined, typed: string): string {
  const name = String(typed ?? "").trim();
  const prefix = prefixFor(customerUrl);

  if (!name) return "";
  if (!prefix) return name;
  if (name.toLowerCase().startsWith(`${prefix}${SEPARATOR}`)) return name;

  return `${prefix}${SEPARATOR}${name}`;
}

/**
 * What to show on screen for a stored name.
 *
 * **Only the customer's own prefix is removed**, which is why this needs the
 * customer. Stripping up to the first separator would turn `john.smith` into
 * `smith` for a person whose username is their full name.
 */
export function strip(customerUrl: string | null | undefined, stored: string): string {
  const name = String(stored ?? "").trim();
  const prefix = prefixFor(customerUrl);

  if (!name || !prefix) return name;
  if (!name.toLowerCase().startsWith(`${prefix}${SEPARATOR}`)) return name;

  return name.slice(prefix.length + SEPARATOR.length);
}
