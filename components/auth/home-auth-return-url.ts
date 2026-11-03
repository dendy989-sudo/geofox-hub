const callbackPath = "/auth/callback?next=/admin/password";
const invalidLink = `${callbackPath}#error=invalid_link`;

/**
 * Hand off only Supabase invitation/recovery fragments that landed on the Site URL.
 * Token verification remains the responsibility of the existing Auth callback.
 * The destination and next path are fixed; caller-supplied redirects are ignored.
 */
export function homeAuthReturnDestination(href: string): string | null {
  let url: URL;
  try { url = new URL(href); }
  catch { return null; }
  if (!["https:", "http:"].includes(url.protocol) || url.pathname !== "/") return null;

  const fragment = new URLSearchParams(url.hash.slice(1));
  const types = fragment.getAll("type");
  if (types.length !== 1 || !["invite", "recovery"].includes(types[0])) return null;

  const hasAuthField = ["access_token", "refresh_token", "error", "error_code", "error_description"].some((key) => fragment.has(key));
  if (!hasAuthField) return null;
  // Error text is untrusted and may include private information. Never forward it.
  if (["error", "error_code", "error_description"].some((key) => fragment.has(key))) return invalidLink;

  const access = fragment.getAll("access_token");
  const refresh = fragment.getAll("refresh_token");
  if (access.length !== 1 || refresh.length !== 1 || !access[0] || !refresh[0] || access[0].length > 16384 || refresh[0].length > 4096) return invalidLink;
  // Credentials remain in the fragment, which browsers do not send in HTTP requests.
  // Omit all unrelated fields, including next, redirect_to, and provider tokens.
  const safeFragment = new URLSearchParams({ type: types[0], access_token: access[0], refresh_token: refresh[0] });
  return `${callbackPath}#${safeFragment}`;
}

interface HomeAuthBrowser {
  location: Pick<Location, "href" | "replace">;
  history: Pick<History, "replaceState">;
}

/** Clear the current history entry before navigating; never persist or log tokens. */
export function handoffHomeAuthReturn(browser: HomeAuthBrowser): boolean {
  const destination = homeAuthReturnDestination(browser.location.href);
  if (!destination) return false;
  browser.history.replaceState(null, "", "/");
  browser.location.replace(destination);
  return true;
}
