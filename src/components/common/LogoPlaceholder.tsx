/**
 * What stands in for a customer's logo until they set one.
 *
 * Deliberately not the product's own logo: showing SmartDoc's mark on a
 * customer's sign-in page reads as branding they never chose. A neutral
 * square with their initial says "nothing here yet" without claiming
 * anything.
 */
export default function LogoPlaceholder({
  name,
  size = "md",
}: {
  name?: string | null;
  size?: "sm" | "md";
}) {
  const initial = name?.trim()?.[0]?.toUpperCase() ?? "?";
  const box = size === "sm" ? "size-8 text-sm rounded-lg" : "size-14 text-xl rounded-xl";

  return (
    <span
      title="No logo set"
      className={`flex items-center justify-center bg-gray-100 font-semibold text-gray-400 dark:bg-white/[0.06] dark:text-gray-500 ${box}`}
    >
      {initial}
    </span>
  );
}
