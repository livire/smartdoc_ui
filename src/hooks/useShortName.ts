import { useCustomer } from "../context/CustomerContext";
import { strip } from "../services/usernameRules";

/**
 * A username with the customer's prefix taken off, for showing to people.
 *
 * One Keycloak realm serves every customer, so a stored username carries the
 * customer: `popo.faisal` for somebody who types `faisal`
 * (`services/usernameRules.ts`). **Nobody outside Keycloak should ever see
 * that form.**
 *
 * **Why a hook and not `strip()` at each place.** Doing it by hand meant
 * finding every screen that prints a name, and the first attempt missed
 * fifteen of them — a dialog heading, four toasts, the user menu's initial,
 * and every "captured by" column in the app. Each needed the customer from
 * context, which made the obvious thing (just print it) also the wrong
 * thing. This makes the short form the easy one:
 *
 * ```ts
 * const short = useShortName();
 * ...
 * {short(row.captured_by_username)}
 * ```
 *
 * It is safe on anything: null, undefined, a name with no prefix (accounts
 * made before this existed), and a name containing a dot of its own —
 * `john.smith` keeps both halves, because only this customer's prefix comes
 * off.
 *
 * **On `/sys`** pass the customer's url in, since the context customer there
 * is somebody else's or nobody's: `useShortName(customer.customer_url)`.
 * A system administrator's own name has no prefix and is unaffected either
 * way.
 */
export function useShortName(forCustomerUrl?: string | null) {
  const { customer } = useCustomer();
  const url = forCustomerUrl !== undefined ? forCustomerUrl : customer?.customer_url ?? null;

  return (name?: string | null) => strip(url, name ?? "");
}
