import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyIngestSignature } from '../lib/security/ingest-signature.ts';
import { redactDiagnostic } from '../lib/hub/redact.ts';
import { getSupabaseConfig } from '../lib/supabase/config.ts';

const secret = 'test-only-0123456789abcdef-0123456789abcdef';
const timestamp = '1793577600';
const now = Number(timestamp) * 1000;
const body = Buffer.from(JSON.stringify({ eventId: 'test-event-1234', kind: 'error', payload: { message: 'Controlled diagnostic' } }));
const signature = createHmac('sha256', secret).update(`${timestamp}.`).update(body).digest('hex');

test('ingress accepts only the exact signed body inside its time window', () => {
  assert.equal(verifyIngestSignature(body, timestamp, signature, secret, now), true);
  assert.equal(verifyIngestSignature(Buffer.concat([body, Buffer.from(' ')]), timestamp, signature, secret, now), false);
  assert.equal(verifyIngestSignature(body, timestamp, signature, secret, now + 300001), false);
  assert.equal(verifyIngestSignature(body, timestamp, signature, secret, now - 300001), false);
  assert.equal(verifyIngestSignature(body, timestamp, signature, 'another-strong-secret-0123456789abcdef', now), false);
});

test('ingress rejects malformed and weak authentication without throwing', () => {
  for (const value of [null, '', '0', 'not-hex', 'f'.repeat(63), 'f'.repeat(66)]) assert.equal(verifyIngestSignature(body, timestamp, value, secret, now), false);
  for (const value of [null, '', '-1793577600', '1793577600.0', '99999999999999999999']) assert.equal(verifyIngestSignature(body, value, signature, secret, now), false);
  assert.equal(verifyIngestSignature(body, timestamp, signature, 'weak', now), false);
});

test('diagnostic persistence removes common account and credential values', () => {
  const input = 'email=person@example.test account 123e4567-e89b-42d3-a456-426614174000 Authorization: Bearer abcdef secret=private-value URL https://user:pass@example.test/api?token=secret#fragment';
  const output = redactDiagnostic(input);
  for (const privateValue of ['person@example.test', '123e4567-e89b-42d3-a456-426614174000', 'abcdef', 'private-value', 'user:pass', 'token=secret', '#fragment']) assert.equal(output.includes(privateValue), false, privateValue);
});

test('incomplete or malformed public Auth configuration remains unavailable without crashing', () => {
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const previousAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  try {
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test_public_only';
    for (const invalid of ['', 'project.supabase.co', 'not-a-url', 'https://name:pass@example.test', 'https://example.test?secret=value', 'https://example.test/auth']) {
      process.env.NEXT_PUBLIC_SUPABASE_URL = invalid;
      assert.equal(getSupabaseConfig(), null);
    }
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example-project.supabase.co';
    assert.equal(getSupabaseConfig()?.url, 'https://example-project.supabase.co');
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_secret_private_test';
    assert.equal(getSupabaseConfig(), null);
    const jwt = role => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.test`;
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = jwt('service_role');
    assert.equal(getSupabaseConfig(), null);
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = jwt('anon');
    assert.ok(getSupabaseConfig());
  } finally {
    for (const [key, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: previousUrl, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: previousKey, NEXT_PUBLIC_SUPABASE_ANON_KEY: previousAnon })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
