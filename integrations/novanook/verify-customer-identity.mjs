// Isolated source identity/security fixture; never connects to Supabase.
// Run: node integrations/novanook/verify-customer-identity.mjs
// PGLITE_MODULE may point to a separately installed @electric-sql/pglite module.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const { PGlite } = createRequire(import.meta.url)(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const migration = await readFile(new URL('./20261103134054_geofox_hub_customer_identity.sql', import.meta.url), 'utf8');
const db = new PGlite();
const id = value => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const fixture = `
  create role anon;
  create role authenticated;
  create role service_role bypassrls;
  create role unrelated_app;
  create schema auth;
  create function auth.role() returns text language sql stable as $$
    select nullif(current_setting('request.jwt.claim.role', true), '');
  $$;
  create table auth.users (
    id uuid primary key,
    email varchar(255),
    email_confirmed_at timestamptz,
    deleted_at timestamptz,
    banned_until timestamptz,
    is_anonymous boolean default false
  );
  create table auth.sessions (
    id uuid primary key,
    user_id uuid not null references auth.users(id) on delete cascade,
    not_after timestamptz
  );
  -- Simulate Supabase projects that grant RPCs to API roles by default.
  alter default privileges in schema public grant execute on functions to anon, authenticated;
`;
let checks = 0;

function check(condition, message) { assert.ok(condition, message); checks++; }
function equal(actual, expected, message) { assert.deepEqual(actual, expected, message); checks++; }
async function query(sql, params = []) { return (await db.query(sql, params)).rows; }
async function identity(user = id(1), session = id(101)) {
  return (await query('select public.geofox_hub_customer_identity($1::uuid,$2::uuid) as identity', [user, session]))[0].identity;
}
async function role(name, claim = name) {
  assert.ok(['postgres', 'anon', 'authenticated', 'service_role', 'unrelated_app'].includes(name));
  await db.exec(`reset role; set role ${name};`);
  await query("select set_config('request.jwt.claim.role',$1,false)", [claim]);
}
async function denied(callback, message, code = '42501') {
  await assert.rejects(callback, error => error.code === code, message);
  checks++;
}
async function preflightRejects(change, expected) {
  const probe = new PGlite();
  try {
    await probe.exec(fixture);
    await probe.exec(change);
    await assert.rejects(() => probe.exec(migration), error => error.code === '55000' && error.message.includes(expected));
    checks++;
    await probe.exec('rollback');
    const state = (await probe.query("select to_regprocedure('public.geofox_hub_customer_identity(uuid,uuid)') as rpc")).rows[0];
    equal(state.rpc, null, 'Failed preflight creates no callable identity RPC');
  } finally { await probe.close(); }
}

try {
  await preflightRejects('drop table auth.sessions;', 'auth.sessions');
  await preflightRejects('alter table auth.sessions drop column not_after;', 'auth.sessions.not_after');
  await preflightRejects('alter table auth.users drop column is_anonymous;', 'auth.users.is_anonymous');
  await preflightRejects('alter table auth.users drop column email_confirmed_at;', 'auth.users.email_confirmed_at');
  await preflightRejects('alter table auth.sessions alter column not_after type text using not_after::text;', 'auth.sessions.not_after type');
  await preflightRejects('drop function auth.role();', 'auth.role()');

  await db.exec(fixture);
  await db.exec(migration);
  // A repeat application must also remove previously/default-granted client access.
  await db.exec('grant execute on function public.geofox_hub_customer_identity(uuid,uuid) to public,anon,authenticated;');
  await db.exec(migration);

  for (let n = 1; n <= 12; n++) {
    await query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [id(n), `fixture${n}@example.invalid`]);
    await query('insert into auth.sessions(id,user_id) values($1,$2)', [id(100 + n), id(n)]);
  }
  await query("update auth.users set banned_until=now()+interval '1 day' where id=$1", [id(3)]);
  await query('update auth.users set deleted_at=now() where id=$1', [id(4)]);
  await query('update auth.users set email_confirmed_at=null where id=$1', [id(5)]);
  await query('update auth.users set is_anonymous=true where id=$1', [id(6)]);
  await query('update auth.users set email=null where id=$1', [id(7)]);
  await query("update auth.users set email='   ' where id=$1", [id(8)]);
  await query('update auth.users set is_anonymous=null where id=$1', [id(9)]);
  await query("update auth.users set banned_until=now()-interval '1 second' where id=$1", [id(10)]);
  await query("update auth.sessions set not_after=now()-interval '1 second' where id=$1", [id(111)]);
  await query("insert into auth.sessions(id,user_id,not_after) values($1,$2,now()+interval '1 hour'),($3,$2,now()),($4,$2,null)", [id(201), id(1), id(202), id(203)]);

  const properties = (await query(`select prosecdef, provolatile, proconfig,
    has_function_privilege('service_role', oid, 'EXECUTE') as service_exec,
    has_function_privilege('anon', oid, 'EXECUTE') as anon_exec,
    has_function_privilege('authenticated', oid, 'EXECUTE') as authenticated_exec,
    has_function_privilege('unrelated_app', oid, 'EXECUTE') as public_exec
    from pg_proc where oid='public.geofox_hub_customer_identity(uuid,uuid)'::regprocedure`))[0];
  check(properties.prosecdef && properties.provolatile === 's' && properties.proconfig.includes('search_path=""'), 'Identity RPC is a read-only definer with fixed empty search_path');
  check(properties.service_exec && !properties.anon_exec && !properties.authenticated_exec && !properties.public_exec, 'Only service_role receives application EXECUTE privileges, including after reapplication');

  for (const caller of ['anon', 'authenticated', 'unrelated_app']) {
    await role(caller, 'service_role');
    await denied(() => identity(), `${caller} cannot call identity even with a forged service-role claim`);
  }
  for (const claim of ['authenticated', 'anon', '']) {
    await role('service_role', claim);
    await denied(() => identity(), 'Service database role must also carry the service JWT role');
  }

  await role('service_role');
  const expected = { id: id(1), email: 'fixture1@example.invalid', emailVerified: true };
  equal(await identity(), expected, 'Current verified nonanonymous account with a retained session is accepted');
  equal(await identity(id(1), id(201)), expected, 'Future explicit session deadline is accepted');
  equal(await identity(id(1), id(102)), null, 'Another user\'s retained session cannot authenticate this customer');
  equal(await identity(id(2), id(101)), null, 'The customer ID cannot be substituted for the session owner');
  equal(await identity(id(999), id(101)), null, 'Unknown customer yields no identity');
  equal(await identity(id(1), id(999)), null, 'Unknown session yields no identity');
  equal(await identity(null, id(101)), null, 'Missing customer ID yields no identity');
  equal(await identity(id(1), null), null, 'Missing session ID yields no identity');
  equal(await identity(id(11), id(111)), null, 'Expired explicit session deadline fails even while its row remains');
  equal(await identity(id(1), id(202)), null, 'A session deadline at or before the current statement is rejected');
  for (const [n, reason] of [[3, 'banned'], [4, 'soft-deleted'], [5, 'unconfirmed'], [6, 'anonymous'], [7, 'missing-email'], [8, 'blank-email'], [9, 'unknown-anonymous-state']]) {
    equal(await identity(id(n), id(100 + n)), null, `${reason} account yields no identity`);
  }
  equal(await identity(id(10), id(110)), { id: id(10), email: 'fixture10@example.invalid', emailVerified: true }, 'A ban that has already ended does not block support');
  await denied(() => identity('invalid-uuid', id(101)), 'Malformed UUID input is rejected before the lookup', '22P02');

  await role('postgres');
  await query('delete from auth.sessions where id=$1', [id(203)]);
  await query('delete from auth.users where id=$1', [id(12)]);
  await query('update auth.users set email=$2 where id=$1', [id(1), 'current-email@example.invalid']);
  await role('service_role');
  equal(await identity(id(1), id(203)), null, 'A removed signed-out session yields no identity');
  equal(await identity(id(12), id(112)), null, 'Hard-deleted account and its cascaded session yield no identity');
  equal(await identity(), { id: id(1), email: 'current-email@example.invalid', emailVerified: true }, 'Identity uses the current source email, never stale JWT/profile values');

  // No plan, profile, moderation, or customer-content tables exist in this fixture:
  // eligible free customers can seek support without any unrelated source reads.
  await role('postgres');
  const relations = await query("select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE'");
  equal(relations, [], 'The source migration adds no customer-data tables and depends on no application tables');
  console.log(`NovaNook customer identity fixture passed: ${checks} checks.`);
} finally {
  await db.close();
}
