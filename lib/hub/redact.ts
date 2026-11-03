/** Redact operational diagnostics before persistence or a copyable AI brief. */
export function redactDiagnostic(value: unknown, maxLength = 4000): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/\b(?:Bearer|Basic)\s+\S+/gi, "[redacted authorization]")
    .replace(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, "[redacted private key]")
    .replace(/\b(?:sb_secret_|sb_publishable_|sk_live_|sk_test_|rk_live_|rk_test_|pk_live_|pk_test_|whsec_|sk-proj-|sk-|ghp_|gho_|ghu_|ghs_|ghr_|github_pat_|xox[baprs]-|re_)[A-Za-z0-9_.-]{8,}/g, "[redacted key]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted token]")
    .replace(/((?:["']?)(?:password|passwd|authorization|api[_-]?key|secret|client[_-]?secret|access[_-]?token|refresh[_-]?token|token|cookie|email|phone|address|full[_-]?name|date[_-]?of[_-]?birth|dob)(?:["']?)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}&]+)/gi, "$1[redacted]")
    .replace(/\b(?:postgres(?:ql)?|redis|mongodb(?:\+srv)?):\/\/[^\s<>"']+/gi, "[redacted connection]")
    .replace(/https?:\/\/[^\s<>"']+/gi, (url) => {
      try {
        const parsed = new URL(url);
        return `${parsed.origin}${parsed.pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "[customer]")}${parsed.search ? "?[redacted]" : ""}`;
      } catch { return "[redacted URL]"; }
    })
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted email]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[redacted ID]")
    .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}[^\s]*/g, "[timestamp]")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[redacted IP]")
    .replace(/(?:\+?\d[\d ()-]{7,}\d)/g, "[redacted number]")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .slice(0, maxLength);
}

export function suggestErrorAction(code: string | null, message: string): string {
  const signal = `${code || ""} ${message}`.toLowerCase();
  if (/429|quota|rate.?limit|too many/.test(signal)) return "Check the provider's usage and retry window. Confirm caching and request limits before retrying; avoid repeated calls while the limit is active.";
  if (/42501|permission|row.level|rls|forbidden/.test(signal)) return "Check the user's role, ownership, and the specific database policy. Reproduce with the affected role; keep access controls enabled.";
  if (/pgrst202|pgrst205|42p01|42883|does not exist|schema cache/.test(signal)) return "Compare the deployed code with applied database migrations, verify the named table or function, and refresh the schema cache only after the schema is correct.";
  if (/401|jwt|token|session|unauthor/.test(signal)) return "Check session refresh and authentication configuration. Reproduce after a fresh sign-in without recording tokens or credentials.";
  if (/timeout|network|fetch|offline|econn/.test(signal)) return "Check the app and provider health, identify the failing request, and confirm bounded retries and a clear offline message.";
  if (/billing|receipt|entitlement|purchase|payment/.test(signal)) return "Verify the store transaction and server entitlement record. Reconcile verified billing events; never infer a purchase from client input alone.";
  return "Review the affected route and release, reproduce the issue, and compare it with related errors. Make the smallest supported fix and verify the affected workflow before deploying.";
}
