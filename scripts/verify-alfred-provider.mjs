// Manual release diagnostic only. Never runs as part of normal builds or cron.
// Run only when an owner has authorized one bounded provider test.
import { gateway, generateText, Output } from 'ai';
import { outputSchema } from '../lib/alfred/schema.ts';
import { redactDiagnostic } from '../lib/hub/redact.ts';

if (!process.argv.includes('--confirm-provider-test')) {
  console.error('Pass --confirm-provider-test to authorize one synthetic model request.');
  process.exit(2);
}
function safeError(error) {
  const chain = []; const seen = new Set();
  for (let e = error; e && typeof e === 'object' && chain.length < 4 && !seen.has(e); e = e.cause) {
    seen.add(e);
    let providerType;
    try { providerType = JSON.parse(e.responseBody ?? '{}')?.error?.type; } catch {}
    chain.push({ name: typeof e.name === 'string' ? e.name : 'Error', status: e.statusCode ?? null, type: e.type ?? providerType ?? null, message: redactDiagnostic(e.message, 1200) });
  }
  return chain;
}
console.log('ALFRED_PROVIDER_AUTH', JSON.stringify({ environment: process.env.VERCEL_ENV ?? 'local', oidcPresent: Boolean(process.env.VERCEL_OIDC_TOKEN), gatewayKeyPresent: Boolean(process.env.AI_GATEWAY_API_KEY) }));
try {
  const credits = await gateway.getCredits();
  console.log('ALFRED_PROVIDER_CREDITS', JSON.stringify(credits));
} catch (error) { console.log('ALFRED_PROVIDER_CREDITS_ERROR', JSON.stringify(safeError(error))); }
try {
  const result = await generateText({ model: 'openai/gpt-5.4-mini', prompt: 'Synthetic connection test. Return report: Connection verified. Return empty limitations and proposals arrays. Do not perform actions.', output: Output.object({ schema: outputSchema }), maxOutputTokens: 500, maxRetries: 0, abortSignal: AbortSignal.timeout(30000) });
  console.log('ALFRED_PROVIDER_RESULT', JSON.stringify({ success: true, output: result.output, usage: result.usage, finishReason: result.finishReason }));
} catch (error) { console.log('ALFRED_PROVIDER_RESULT', JSON.stringify({ success: false, errors: safeError(error) })); }
