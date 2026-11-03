// Run with Node 24 and @electric-sql/pglite available. PGLITE_MODULE may point to
// an installed PGlite entry point when keeping test dependencies outside this repo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { redactDiagnostic } from '../../lib/hub/redact.ts';
import { isAppSlug, reviewPeriod } from '../../lib/hub/validation.ts';

const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const owner = '10000000-0000-4000-8000-000000000001';
const support = '10000000-0000-4000-8000-000000000002';
const moderator = '10000000-0000-4000-8000-000000000003';
const analyst = '10000000-0000-4000-8000-000000000004';
const invited = '10000000-0000-4000-8000-000000000005';
const inactive = '10000000-0000-4000-8000-000000000006';
const banned = '10000000-0000-4000-8000-000000000007';

await db.exec(`
  create role anon;
  create role authenticated;
  create role service_role bypassrls;
  create schema auth;
  create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,banned_until timestamptz,deleted_at timestamptz);
  insert into auth.users(id,email,email_confirmed_at,banned_until) values
    ('${owner}','owner@example.test',now(),null),
    ('${support}','support@example.test',now(),null),
    ('${moderator}','moderator@example.test',now(),null),
    ('${analyst}','analyst@example.test',now(),null),
    ('${invited}','invited@example.test',null,null),
    ('${inactive}','inactive@example.test',now(),null),
    ('${banned}','banned@example.test',now(),now()+interval '1 day');
`);
const migration = await readFile(new URL('../migrations/202611030001_geofox_hub.sql', import.meta.url), 'utf8');
await db.exec(migration);
const bootstrap = await readFile(new URL('../bootstrap_owner.sql', import.meta.url), 'utf8');
// Replace only the declared value; the template guard must remain intact.
await db.exec(bootstrap.replace("owner_email text := 'REPLACE_WITH_YOUR_VERIFIED_COMPANY_EMAIL'", "owner_email text := 'owner@example.test'"));
await db.exec(`
  insert into public.hub_apps(slug,name,website) values('otherapp','Other app','https://example.test');
  insert into public.hub_staff(user_id,display_name,role,active) values
    ('${support}','Support','support',true),('${moderator}','Moderator','moderator',true),
    ('${analyst}','Analyst','analyst',true),('${inactive}','Inactive','admin',false),('${banned}','Banned','admin',true);
  insert into public.hub_staff_apps(user_id,app_slug) values
    ('${support}','novanook'),('${moderator}','novanook'),('${analyst}','novanook'),('${inactive}','novanook'),('${banned}','novanook');
`);

async function one(sql, params = []) { return (await db.query(sql, params)).rows[0]; }
async function denied(callback, code = '42501') {
  await assert.rejects(callback, (error) => error.code === code);
}
async function publicTicket(suffix, app = 'novanook', ip = `ip-${suffix}`.padEnd(64, '0'), emailHash = `email-${suffix}`.padEnd(64, '0')) {
  return (await one('select public.hub_create_public_ticket($1,$2,$3,$4,$5,$6) as result',
    [app, `${suffix}@example.test`, `Request ${suffix}`, 'Please help with this account issue.', ip, emailHash])).result;
}
async function ingest(eventId, kind, payload, app = 'novanook') {
  return (await one('select public.hub_accept_ingest($1,$2,$3,$4::jsonb,now()) as result', [app, eventId, kind, JSON.stringify(payload)])).result;
}

test('the migration applies twice, keeps RLS enabled, and denies public data and RPC access', async () => {
  await db.exec(migration);
  const tables = await db.query("select relname,relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relname like 'hub_%' and relkind='r'");
  assert.ok(tables.rows.length >= 15);
  assert.ok(tables.rows.every((row) => row.relrowsecurity));
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    try {
      await denied(() => db.query('select * from public.hub_tickets'));
      await denied(() => db.query('select * from public.hub_staff'));
      await denied(() => db.query("select public.hub_actor_can($1,'staff:write',null)", [owner]));
      await denied(() => publicTicket(`forbidden-${role}`));
    } finally { await db.exec('reset role'); }
  }
});

test('authorization combines role, app scope, confirmation, and account status', async () => {
  for (const [actor, capability, app, expected] of [
    [owner, 'staff:write', null, true], [owner, 'bogus:write', null, false],
    [support, 'tickets:write', 'novanook', true], [support, 'tickets:write', 'otherapp', false],
    [support, 'staff:write', 'novanook', false], [moderator, 'customers:read', 'novanook', false],
    [moderator, 'moderation:write', 'novanook', true], [analyst, 'errors:read', 'novanook', true],
    [analyst, 'errors:write', 'novanook', false], [inactive, 'tickets:read', 'novanook', false],
    [banned, 'tickets:read', 'novanook', false],
  ]) assert.equal((await one('select public.hub_actor_can($1,$2,$3) as allowed', [actor, capability, app])).allowed, expected);
});

test('public ticket creation commits a complete request and atomically enforces IP and email budgets', async () => {
  const ip = 'shared-ip'.padEnd(64, '0');
  const results = await Promise.allSettled(Array.from({ length: 8 }, (_, n) => publicTicket(`burst-${n}`, 'novanook', ip)));
  assert.equal(results.filter((item) => item.status === 'fulfilled').length, 5);
  assert.ok(results.filter((item) => item.status === 'rejected').every((item) => item.reason.code === 'P0001'));
  const emailHash = 'shared-email'.padEnd(64, '0');
  for (let i = 0; i < 3; i++) await publicTicket(`email-${i}`, 'novanook', `email-ip-${i}`.padEnd(64, '0'), emailHash);
  await denied(() => publicTicket('email-overflow', 'novanook', 'email-overflow'.padEnd(64, '0'), emailHash), 'P0001');
  const missingMessages = await one('select count(*)::int as count from public.hub_tickets t where not exists(select 1 from public.hub_ticket_messages m where m.ticket_id=t.id)');
  assert.equal(missingMessages.count, 0);
  assert.equal((await one('select count(*)::int as count from public.hub_tickets where identity_verified')).count, 0);
});

test('ticket writes are scoped and mail delivery cannot claim an internal note was sent', async () => {
  const ticket = await publicTicket('scope-own');
  const foreign = await publicTicket('scope-foreign', 'otherapp');
  await denied(() => db.query("select public.hub_update_ticket($1,$2,'resolved')", [support, foreign.id]));
  await denied(() => db.query("select public.hub_update_ticket($1,$2,'resolved')", [moderator, ticket.id]));
  await db.query("select public.hub_update_ticket($1,$2,'in_progress')", [support, ticket.id]);
  assert.equal((await one('select status from public.hub_tickets where id=$1', [ticket.id])).status, 'in_progress');
  const message = (await one("select public.hub_add_ticket_message($1,$2,'Reviewed this issue',true) as id", [support, ticket.id])).id;
  await denied(() => db.query("select public.hub_set_ticket_delivery($1,$2,$3,'sent')", [support, ticket.id, message]), '22023');
  const reply = (await one("select public.hub_add_ticket_message($1,$2,'Please retry the search',false,'pending') as id", [support, ticket.id])).id;
  await db.query("select public.hub_set_ticket_delivery($1,$2,$3,'sent')", [support, ticket.id, reply]);
  assert.equal((await one('select delivery_status from public.hub_ticket_messages where id=$1', [reply])).delivery_status, 'sent');
});

test('staff management cannot promote to owner, revoke the owner, or be invoked by support', async () => {
  const args = [owner, invited, 'New team member', 'support', true, ['novanook']];
  await denied(() => db.query('select public.hub_save_staff($1,$2,$3,$4,$5,$6)', [support, ...args.slice(1)]));
  await denied(() => db.query('select public.hub_save_staff($1,$2,$3,$4,$5,$6)', [owner, owner, 'Changed owner', 'admin', false, ['novanook']]));
  await denied(() => db.query('select public.hub_save_staff($1,$2,$3,$4,$5,$6)', [owner, invited, 'New owner', 'owner', true, ['novanook']]), '22023');
  await db.query('select public.hub_save_staff($1,$2,$3,$4,$5,$6)', args);
  assert.equal((await one("select public.hub_actor_can($1,'tickets:read','novanook') as allowed", [invited])).allowed, false, 'Unconfirmed invited accounts cannot access staff data');
  await db.query('update auth.users set email_confirmed_at=now() where id=$1', [invited]);
  assert.equal((await one("select public.hub_actor_can($1,'tickets:read','novanook') as allowed", [invited])).allowed, true);
  assert.equal(isAppSlug('all'), false, 'The global app scope cannot become an app ID');
  await denied(() => db.query("select public.hub_save_app($1,'all','Reserved','https://example.test','#123456')", [owner]), '23514');
});

test('all-app review changes roll back when any app is outside scope', async () => {
  await denied(() => db.query("select public.hub_complete_reviews($1,array['novanook','otherapp'],'service-health',current_date,true)", [support]));
  assert.equal((await one("select count(*)::int as count from public.hub_review_checks where task_key='service-health'")).count, 0);
  await denied(() => db.query("select public.hub_complete_review($1,'novanook','service-health',current_date,true)", [analyst]));
  await db.query("select public.hub_complete_reviews($1,array['novanook','otherapp'],'service-health',current_date,true)", [owner]);
  assert.equal((await one("select count(*)::int as count from public.hub_review_checks where task_key='service-health'")).count, 2);
});

test('error ingestion is replay-safe and retains scoped customer occurrence links', async () => {
  const payload = { fingerprint: 'fingerprint-test-one', title: 'Search failed', message: 'Provider timeout', code: 'TIMEOUT', severity: 'error', source: 'search', customerId: 'customer-one', suggestedAction: 'Check provider health.' };
  const first = await ingest('error-event-0001', 'error', payload);
  assert.equal((await ingest('error-event-0001', 'error', payload)).duplicate, true);
  assert.equal((await one('select occurrence_count::int as count from public.hub_errors where id=$1', [first.id])).count, 1);
  await db.query("select public.hub_update_error($1,$2,'resolved')", [support, first.id]);
  await ingest('error-event-0002', 'error', { ...payload, customerId: 'customer-two' });
  const grouped = await one('select occurrence_count::int as count,status,customer_id from public.hub_errors where id=$1', [first.id]);
  assert.deepEqual(grouped, { count: 2, status: 'open', customer_id: null });
  assert.equal((await one('select count(*)::int as count from public.hub_error_events where error_id=$1', [first.id])).count, 2);
  const customerErrors = (await one("select public.hub_customer_errors(array['novanook'],'customer-one') as result")).result;
  assert.equal(customerErrors.total, 1);
  assert.equal(customerErrors.items[0].occurrence_count, 1, 'Customer details must not count another customer’s occurrences');
  assert.equal(customerErrors.items[0].customer_id, 'customer-one');
  const selected = (await one("select public.hub_customer_errors(array['novanook'],'customer-one',null,50,0,$1::uuid[]) as result", [[first.id]])).result;
  assert.equal(selected.items[0].occurrence_count, 1);
  assert.equal(selected.total, 1);
  const emptySelection = (await one("select public.hub_customer_errors(array['novanook'],'customer-one',null,50,0,array[]::uuid[]) as result")).result;
  assert.equal(emptySelection.total, 0);
  const outsideScope = (await one("select public.hub_customer_errors(array['otherapp'],'customer-one',null,50,0,$1::uuid[]) as result", [[first.id]])).result;
  assert.equal(outsideScope.total, 0);
  await denied(() => db.query("select public.hub_customer_errors(array['novanook'],'customer-one',null,50,0,$1::uuid[])", [Array(31).fill(first.id)]), '22023');
});

test('verified billing events deduplicate, enforce refund signs, and report currencies separately', async () => {
  const paid = { verified: true, environment: 'production', provider: 'apple', transactionId: 'tx-one', status: 'paid', amountMinor: 1000, currency: 'USD' };
  await denied(() => ingest('pay-unverified-1', 'payment', { ...paid, verified: false }), '22023');
  await denied(() => ingest('pay-sandbox-0001', 'payment', { ...paid, environment: 'sandbox' }), '22023');
  await denied(() => ingest('pay-missing-env1', 'payment', { ...paid, environment: undefined }), '22023');
  await ingest('payment-event-01', 'payment', paid);
  assert.equal((await ingest('payment-event-01', 'payment', paid)).duplicate, true);
  assert.equal((await ingest('payment-event-02', 'payment', paid)).duplicate, true);
  await denied(() => ingest('pay-conflict-amt1', 'payment', { ...paid, amountMinor: 9999 }), '22023');
  await denied(() => ingest('pay-conflict-cur1', 'payment', { ...paid, currency: 'EUR' }), '22023');
  await denied(() => ingest('pay-conflict-who1', 'payment', { ...paid, customerId: 'different-account' }), '22023');
  await denied(() => ingest('pay-refund-bad-1', 'payment', { ...paid, transactionId: 'refund-one', status: 'refunded', amountMinor: 300 }), '23514');
  await ingest('pay-refund-good-1', 'payment', { ...paid, transactionId: 'refund-one', status: 'refunded', amountMinor: -300 });
  await ingest('pay-eur-unknown-1', 'payment', { ...paid, transactionId: 'eur-unknown', amountMinor: null, currency: 'EUR' });
  const summary = (await one("select public.hub_reporting_summary(array['novanook'],now()-interval '1 day',now()+interval '1 minute') as result")).result;
  const usd = summary.paymentTotals.find((row) => row.currency === 'USD');
  assert.equal(usd.amountMinor, 700);
  assert.equal(usd.count, 2);
  assert.equal(summary.paymentTotals.find((row) => row.currency === 'EUR').amountMinor, null);
  assert.equal(summary.dailyErrors.reduce((sum, row) => sum + row.count, 0), 2);
  assert.equal((await one("select count(*)::int as count from public.hub_ingest_events where event_id='pay-refund-bad-1'")).count, 0, 'Rejected payment does not consume its idempotency key');
});

test('diagnostics redact tokens, IDs, private URLs, contact details, and connection strings', () => {
  const input = 'Bearer secret-value email=user@example.com phone=+1-555-123-4567 id=123e4567-e89b-12d3-a456-426614174000 https://alice:password@example.com/account?token=hello#secret ghp_abcdefgh12345678 re_abcdefghijkl "secret":"private-key" postgres://user:password@db.example/x';
  const output = redactDiagnostic(input);
  for (const secret of ['secret-value', 'user@example.com', '555-123-4567', '123e4567', 'alice:', 'password@', 'token=hello', '#secret', 'ghp_', 're_abcdefghijkl', 'private-key', 'postgres://']) assert.ok(!output.includes(secret), `Redaction leaked ${secret}`);
  assert.ok(output.includes('https://example.com/account'));
  assert.equal(reviewPeriod('weekly', new Date('2026-01-01T23:59:59Z')), '2025-12-29');
  assert.equal(reviewPeriod('daily', new Date('2026-01-01T23:59:59Z')), '2026-01-01');
});

test.after(async () => { await db.close(); });
