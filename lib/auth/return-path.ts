/** A closed allowlist prevents sign-in query parameters becoming open redirects. */
export function staffReturnPath(value: unknown): "/admin" | "/apps" | "/finance" | "/taxes" {
  return value === "/apps" || value === "/finance" || value === "/taxes" ? value : "/admin";
}
