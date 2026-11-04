// Actual Postgres execution in memory. No production events, credentials, or
// remote network calls are used by these connection-protocol tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';

const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
await db.exec(`
  create role anon;
  create role authenticated;
  create role service_role bypassrls;
  create schema auth;
  create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz, banned_until timestamptz, deleted_at timestamptz);
`);
await db.exec(await readFile(new URL('../migrations/202611030001_geofox_hub.sql', import.meta.url), 'utf8'));
const migrationNames = (await readdir(new URL('../migrations/', import.meta.url)))
  .filter(name => name.endsWith('_telemetry_connection_checks.sql'));
assert.equal(migrationNames.length, 1, 'Use exactly one connection-check migration.');
const migration = await readFile(new URL(`../migrations/${migrationNames[0]}`, import.meta.url), 'utf8');
await db.exec(migration);
await db.exec("insert into public.hub_apps(slug,name,website) values('otherapp','Another app','https://example.test');");

const one = async (sql, parameters = []) => (await db.query(sql, parameters)).rows[0];
const begin = async (challenge = randomUUID(), app = 'novanook') =>
  (await one('select public.hub_begin_telemetry_check($1,$2) as result', [app, challenge])).result;
const accept = async (challenge, app = 'novanook', occurredAt = new Date().toISOString()) =>
  (await one('select public.hub_accept_telemetry_check($1,$2,$3) as result', [app, challenge, occurredAt])).result;
const finish = async (challenge, outcome, latency = 25, app = 'novanook') =>
  (await one('select public.hub_finish_telemetry_check($1,$2,$3,$4) as result', [app, challenge, outcome, latency])).result;
const state = async (app = 'novanook') =>
  (await one('select to_jsonb(c) as result from public.hub_telemetry_checks c where app_slug=$1', [app]))?.result ?? null;
const denied = async (callback, code = '22023') =>
  assert.rejects(callback, error => error.code === code);
async function asOwner(sql, parameters = []) {
  await db.exec('reset role');
  try { return await db.query(sql, parameters); }
  finally { await db.exec('set role service_role'); }
}
async function ageCheck(seconds, app = 'novanook') {
  await asOwner(`update public.hub_telemetry_checks set
    started_at=started_at-make_interval(secs=>$1), expires_at=expires_at-make_interval(secs=>$1),
    accepted_at=accepted_at-make_interval(secs=>$1), last_success_at=last_success_at-make_interval(secs=>$1)
    where app_slug=$2`, [seconds, app]);
}
async function counts() {
  return one(`select
    (select count(*)::int from public.hub_errors) as errors,
    (select count(*)::int from public.hub_error_events) as occurrences,
    (select count(*)::int from public.hub_ingest_events) as application_events,
    (select count(*)::int from public.hub_usage_events) as usage,
    (select count(*)::int from public.hub_payments) as payments`);
}

test.beforeEach(async () => {
  await db.exec(`reset role; truncate public.hub_telemetry_checks;
    update public.hub_apps set active=true; set role service_role;`);
});
test.after(async () => { await db.close(); });

test('the migration is repeatable and exposes only invoker RPCs and service-role state access', async () => {
  await db.exec('reset role');
  await db.exec(migration);
  const table = await one("select relrowsecurity from pg_class where oid='public.hub_telemetry_checks'::regclass");
  assert.equal(table.relrowsecurity, true);
  const functions = (await db.query(`select proname,prosecdef from pg_proc where oid in (
    'public.hub_begin_telemetry_check(text,uuid)'::regprocedure,
    'public.hub_accept_telemetry_check(text,uuid,timestamptz)'::regprocedure,
    'public.hub_finish_telemetry_check(text,uuid,text,integer)'::regprocedure
  )`)).rows;
  assert.equal(functions.length, 3);
  assert.ok(functions.every(row => row.prosecdef === false));
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    try {
      await denied(() => state(), '42501');
      await denied(() => begin(), '42501');
      await denied(() => accept(randomUUID()), '42501');
      await denied(() => finish(randomUUID(), 'timeout'), '42501');
      await denied(() => db.query("update public.hub_telemetry_checks set outcome='connected'"), '42501');
    } finally { await db.exec('reset role'); }
  }
  await db.exec('set role service_role');
  assert.equal((await begin()).started, true);
  await denied(() => db.query('delete from public.hub_telemetry_checks'), '42501');
});

test('a new check is pending and has a database-issued thirty-second nonce window', async () => {
  const before = Date.now();
  const challenge = randomUUID();
  const result = await begin(challenge);
  assert.equal(result.started, true);
  assert.equal(result.check.app_slug, 'novanook');
  assert.equal(result.check.challenge_id, challenge);
  assert.equal(result.check.outcome, 'pending');
  assert.ok(Date.parse(result.check.started_at) >= before - 1);
  assert.ok(Date.parse(result.check.started_at) <= Date.now() + 1);
  assert.equal(Date.parse(result.check.expires_at) - Date.parse(result.check.started_at), 30_000);
  assert.equal(result.check.accepted_at, null);
  assert.equal(result.check.last_success_at, null);
  assert.equal(result.check.latency_ms, null);
  assert.deepEqual(await state(), result.check);
});

test('a matching receipt records server-time evidence without adding any application event or incident', async () => {
  const beforeCounts = await counts();
  const beforeSummary = (await one("select public.hub_reporting_summary(array['novanook'],now()-interval '1 day',now()+interval '1 minute') as result")).result;
  const { check } = await begin();
  const sourceTime = new Date(Date.now() - 20_000).toISOString();
  const accepted = await accept(check.challenge_id, 'novanook', sourceTime);
  assert.deepEqual(accepted, { accepted: true, duplicate: false, checkId: check.challenge_id });
  const connected = await state();
  assert.equal(connected.outcome, 'connected');
  assert.equal(connected.last_success_at, connected.accepted_at);
  assert.ok(Date.parse(connected.accepted_at) > Date.parse(sourceTime) + 19_000);
  assert.ok(Date.parse(connected.accepted_at) >= Date.parse(check.started_at));
  assert.deepEqual(await counts(), beforeCounts);
  const afterSummary = (await one("select public.hub_reporting_summary(array['novanook'],now()-interval '1 day',now()+interval '1 minute') as result")).result;
  assert.deepEqual(afterSummary, beforeSummary);
});

test('duplicate receipts retain the exact original accepted time and successful check state', async () => {
  const { check } = await begin();
  await accept(check.challenge_id);
  await finish(check.challenge_id, 'connected', 127);
  const original = await state();
  const duplicate = await accept(check.challenge_id);
  assert.deepEqual(duplicate, { accepted: true, duplicate: true, checkId: check.challenge_id });
  assert.deepEqual(await state(), original);
});

test('concurrent check requests share one per-app claim and cannot multiply outbound work', async () => {
  // PGlite queues SQL calls; the database's INSERT/row lock claim is also used
  // in production to serialize callers arriving on separate connections.
  const attempts = await Promise.all(Array.from({ length: 24 }, () => begin()));
  assert.equal(attempts.filter(result => result.started).length, 1);
  const winner = attempts.find(result => result.started).check.challenge_id;
  assert.ok(attempts.every(result => result.check.challenge_id === winner));
  assert.equal((await one('select count(*)::int as count from public.hub_telemetry_checks')).count, 1);
  assert.equal((await state()).challenge_id, winner);
  const other = await begin(randomUUID(), 'otherapp');
  assert.equal(other.started, true, 'Another app has its own connection-check budget.');
});

test('a fresh claim waits sixty seconds, retains the last success, and never reuses its current nonce', async () => {
  const { check } = await begin();
  await accept(check.challenge_id);
  const immediate = await begin();
  assert.equal(immediate.started, false);
  assert.equal(immediate.check.challenge_id, check.challenge_id);
  await ageCheck(61);
  const old = await state();
  assert.equal((await begin(check.challenge_id)).started, false, 'Reusing a nonce must never restart its validity window.');
  const next = await begin();
  assert.equal(next.started, true);
  assert.notEqual(next.check.challenge_id, check.challenge_id);
  assert.equal(next.check.outcome, 'pending');
  assert.equal(next.check.accepted_at, null);
  assert.equal(next.check.latency_ms, null);
  assert.equal(next.check.last_success_at, old.last_success_at);
  assert.equal((await one('select count(*)::int as count from public.hub_telemetry_checks')).count, 1);
});

test('a response alone cannot mark a check connected, and finishing a failure is idempotent', async () => {
  const { check } = await begin();
  await denied(() => finish(check.challenge_id, 'connected'));
  assert.deepEqual(await state(), check);
  const failure = await finish(check.challenge_id, 'authentication', 200);
  assert.equal(failure.outcome, 'authentication');
  assert.equal(failure.latency_ms, 200);
  assert.equal(failure.accepted_at, null);
  assert.equal(failure.last_success_at, null);
  assert.deepEqual(await finish(check.challenge_id, 'timeout', 8000), failure);
});

test('a receipt arriving after a timeout can establish success only inside the original nonce window', async () => {
  const { check } = await begin();
  await finish(check.challenge_id, 'timeout', 8000);
  const accepted = await accept(check.challenge_id);
  assert.equal(accepted.accepted, true);
  const recovered = await state();
  assert.equal(recovered.outcome, 'connected');
  assert.equal(recovered.last_success_at, recovered.accepted_at);
  assert.equal(recovered.latency_ms, null, 'The earlier timeout duration is not a successful round-trip measurement.');
});

test('a delayed failure never downgrades accepted evidence, including after its nonce expires', async () => {
  const { check } = await begin();
  await accept(check.challenge_id);
  await finish(check.challenge_id, 'connected', 179);
  const before = await state();
  assert.deepEqual(await finish(check.challenge_id, 'timeout', 8000), before);
  await ageCheck(31);
  const expired = await state();
  assert.deepEqual(await finish(check.challenge_id, 'delivery_failed', 5000), expired);
  await denied(() => accept(check.challenge_id));
  assert.deepEqual(await state(), expired, 'Expired duplicate receipts do not refresh historical success.');
});

test('old callbacks and finishes cannot overwrite a more recent check', async () => {
  const old = (await begin()).check;
  await finish(old.challenge_id, 'timeout', 8000);
  await ageCheck(61);
  const current = (await begin()).check;
  await denied(() => accept(old.challenge_id));
  assert.deepEqual(await finish(old.challenge_id, 'delivery_failed', 5000), current);
  assert.deepEqual(await state(), current);
});

test('unsolicited, wrong-app, wrong-nonce, and expired callbacks cannot establish a connection', async () => {
  await denied(() => accept(randomUUID()));
  assert.equal(await state(), null);
  const { check } = await begin();
  await begin(randomUUID(), 'otherapp');
  await denied(() => accept(check.challenge_id, 'otherapp'));
  await denied(() => accept(randomUUID()));
  assert.deepEqual(await state(), check);
  await ageCheck(31);
  const expired = await state();
  await denied(() => accept(check.challenge_id));
  assert.deepEqual(await state(), expired);
  assert.equal((await begin()).started, false, 'Expiration does not remove the sixty-second check budget.');
});

test('every RPC rejects inactive and unknown apps without changing stored evidence', async () => {
  const { check } = await begin();
  await asOwner("update public.hub_apps set active=false where slug='novanook'");
  for (const app of ['novanook', 'missingapp', 'all', null]) {
    await denied(() => begin(randomUUID(), app));
    await denied(() => accept(check.challenge_id, app));
    await denied(() => finish(check.challenge_id, 'timeout', 8000, app));
  }
  assert.deepEqual(await state(), check);
});

test('invalid timestamps, null challenges, unsupported outcomes, and unbounded latency are rejected', async () => {
  await denied(() => begin(null));
  const { check } = await begin();
  await denied(() => accept(null));
  for (const occurredAt of [null, 'infinity', '-infinity', new Date(Date.now() - 120_000).toISOString(), new Date(Date.now() + 120_000).toISOString()]) {
    await denied(() => accept(check.challenge_id, 'novanook', occurredAt));
  }
  for (const outcome of [null, 'pending', 'healthy', 'private free text']) {
    await denied(() => finish(check.challenge_id, outcome));
  }
  for (const latency of [-1, 10001]) await denied(() => finish(check.challenge_id, 'timeout', latency));
  await denied(() => finish(null, 'timeout'));
  await denied(() => accept('invalid-uuid'), '22P02');
  await denied(() => finish(check.challenge_id, 'timeout', 0.5), '22P02');
  assert.deepEqual(await state(), check);
});
