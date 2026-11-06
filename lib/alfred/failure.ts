/** Reduce SDK/Gateway error chains to fixed messages and non-sensitive diagnostics. */
export interface AlfredFailure {
  code: string;
  message: string;
  statusCode: number | null;
  generationId: string | null;
  providerAttemptCount: number | null;
  noProviderAttempts: boolean;
}
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
export function classifyAlfredFailure(error: unknown): AlfredFailure {
  let current = record(error);
  const seen = new Set<unknown>();
  const signals: string[] = [];
  const attempts: number[] = [];
  let statusCode: number | null = null, generationId: string | null = null;
  for (let depth = 0; current && depth < 6 && !seen.has(current); depth++) {
    seen.add(current);
    for (const field of ["name", "type", "code", "message"]) if (typeof current[field] === "string") signals.push(current[field].slice(0, 8000));
    if (statusCode === null && typeof current.statusCode === "number" && Number.isInteger(current.statusCode) && current.statusCode >= 400 && current.statusCode <= 599) statusCode = current.statusCode;
    let body: Record<string, unknown> | null = null;
    if (typeof current.responseBody === "string" && current.responseBody.length <= 32000) {
      try { body = record(JSON.parse(current.responseBody)); } catch { /* malformed provider errors remain uncertain */ }
    }
    const detail = record(body?.error);
    for (const field of ["type", "code", "message"]) if (typeof detail?.[field] === "string") signals.push(detail[field].slice(0, 8000));
    const gateway = record(record(body?.providerMetadata)?.gateway);
    const routing = record(gateway?.routing);
    const count = routing?.totalProviderAttemptCount;
    if (typeof count === "number" && Number.isSafeInteger(count) && count >= 0) attempts.push(count);
    for (const candidate of [current.generationId, body?.generationId, gateway?.generationId]) {
      if (typeof candidate === "string" && /^gen_[A-Za-z0-9_-]{1,128}$/.test(candidate)) generationId ??= candidate;
    }
    current = record(current.cause);
  }
  const signal = signals.join(" ").toLowerCase();
  let code = "ALFRED_PROVIDER_FAILURE";
  let message = "Alfred could not complete the model request. Review the recorded diagnostic code before retrying; the cause was not confirmed.";
  if (/free tier users do not have access|restrictedmodelserror|free.tier.*model.*(?:access|restricted)/.test(signal) && statusCode === 403) {
    code = "ALFRED_MODEL_ACCESS_RESTRICTED";
    message = "Alfred's selected model requires paid Vercel AI Gateway credits; free credits do not unlock it. In Vercel, select your team, open AI Gateway, and click the credit balance to add paid credits. No automatic purchase was made.";
  } else if (signal.includes("customer_verification_required")) {
    code = "ALFRED_GATEWAY_VERIFICATION";
    message = "Vercel requires account/payment-method verification before AI Gateway can process requests. Complete the verification shown in your team's AI Gateway dashboard.";
  } else if (signal.includes("quota_for_entity_exceeded")) {
    code = "ALFRED_GATEWAY_BUDGET";
    message = "A Vercel AI Gateway budget blocked this request. Review the team's, project's, or key's Gateway budget. Alfred's local allowance is separate.";
  } else if (signal.includes("insufficient_funds") || statusCode === 402) {
    code = "ALFRED_GATEWAY_CREDITS";
    message = "Vercel AI Gateway rejected the request for billing or credit availability. Review the AI Gateway credit balance and billing notice before retrying.";
  } else if (statusCode === 401 || signal.includes("authentication_error")) {
    code = "ALFRED_GATEWAY_AUTH";
    message = "Vercel AI Gateway could not authenticate this request. Review Geofox Hub's project OIDC configuration or its server-only AI_GATEWAY_API_KEY. Do not enter credentials in Alfred's prompt.";
  } else if (statusCode === 403) {
    code = "ALFRED_GATEWAY_FORBIDDEN";
    message = "Vercel AI Gateway denied this model request. Review model/provider access and Gateway policy restrictions; the denial does not by itself mean credits are missing.";
  } else if (statusCode === 429) {
    code = "ALFRED_GATEWAY_RATE_LIMIT";
    message = "The AI provider is rate-limiting requests. Wait for its retry window and check Activity before starting another investigation.";
  } else if (statusCode === 400) {
    code = "ALFRED_MODEL_REQUEST_INVALID";
    message = "The AI provider rejected the request format or model settings. This requires an integration check; changing your approval setting will not fix it.";
  } else if (statusCode === 404 || signal.includes("model_not_found")) {
    code = "ALFRED_MODEL_UNAVAILABLE";
    message = "The selected AI model is unavailable through this Gateway connection. Review model availability before retrying.";
  } else if (/noobjectgenerated|typevalidation|jsonparse/.test(signal)) {
    code = "ALFRED_OUTPUT_INVALID";
    message = "The model did not return a valid structured report. No proposed action was accepted. Model usage may still have been incurred.";
  } else if (statusCode === 408 || /aborterror|timeouterror/.test(signal)) {
    code = "ALFRED_MODEL_TIMEOUT";
    message = "The model request timed out or was interrupted. Its provider outcome is uncertain, so the request will not be automatically repeated.";
  }
  return { code, message, statusCode, generationId, providerAttemptCount: attempts.length ? Math.max(...attempts) : null, noProviderAttempts: attempts.length > 0 && attempts.every(n => n === 0) };
}

