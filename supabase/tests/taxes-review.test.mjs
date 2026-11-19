import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const { PGlite } = await import(process.env.PGLITE_MODULE || "@electric-sql/pglite");
const db = new PGlite();
const owner = "20000000-0000-4000-8000-000000000001";
const other = "20000000-0000-4000-8000-000000000002";
const support = "20000000-0000-4000-8000-000000000003";
const banned = "20000000-0000-4000-8000-000000000004";
const unverified = "20000000-0000-4000-8000-000000000005";
const inactive = "20000000-0000-4000-8000-000000000006";
await db.exec(`
  create role anon; create role authenticated; create role service_role bypassrls;
  alter default privileges in schema public grant all on tables to service_role;
  create schema auth;
  create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,banned_until timestamptz,deleted_at timestamptz);
  insert into auth.users values
  ('${owner}','janna@geofoxapps.com',now(),null,null),
  ('${other}','other@example.test',now(),null,null),
  ('${support}','support@example.test',now(),null,null),
  ('${banned}','banned@example.test',now(),now()+interval '1 year',null),
  ('${unverified}','unverified@example.test',null,null,null),
  ('${inactive}','inactive@example.test',now(),null,null);
  create schema storage;
  create table storage.buckets(id text primary key,name text not null,public boolean default false,file_size_limit bigint,allowed_mime_types text[]);
  create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null,name text not null);
  alter table storage.objects enable row level security;
  grant usage on schema storage to anon,authenticated,service_role;
  grant select,insert,update,delete on storage.objects to anon,authenticated,service_role;
  create policy existing_permissive_storage_policy on storage.objects for all to anon,authenticated using(true) with check(true);
`);
for (const filename of ["202611030001_geofox_hub.sql"]) {
  await db.exec(await readFile(new URL(`../migrations/${filename}`, import.meta.url), "utf8"));
}
const bootstrap = await readFile(new URL("../bootstrap_owner.sql", import.meta.url), "utf8");
await db.exec(bootstrap.replace("owner_email text := 'REPLACE_WITH_YOUR_VERIFIED_COMPANY_EMAIL'", "owner_email text := 'janna@geofoxapps.com'"));
await db.exec(`insert into public.hub_staff(user_id,display_name,role,active) values
  ('${other}','Second owner','owner',true),('${support}','Support','support',true),
  ('${banned}','Banned','owner',true),('${unverified}','Unverified','owner',true),('${inactive}','Inactive','owner',false)`);
for (const filename of ["20261105164728_private_finance_dashboard.sql", "20261105170745_finance_access_service_readonly.sql"]) {
  await db.exec(await readFile(new URL(`../migrations/${filename}`, import.meta.url), "utf8"));
}
const migration = await readFile(new URL("../migrations/20261118163746_private_tax_workspace.sql", import.meta.url), "utf8");
await db.exec(migration);
const crossMigration = await readFile(new URL("../migrations/20261119072500_taxes_statement_cross_years.sql",import.meta.url),"utf8");
await db.exec(crossMigration);

async function row(query, values = []) { return (await db.query(query, values)).rows[0]; }
async function role(name, callback) {
  await db.exec(`set role ${name}`);
  try { return await callback(); } finally { await db.exec("reset role"); }
}
async function denied(callback, codes = ["42501"]) {
  await assert.rejects(callback, error => codes.includes(error.code), `Expected rejection with ${codes.join(" or ")}`);
}
async function save(value, actor = owner) {
  return (await row("select public.taxes_save_record($1,$2::jsonb) result", [actor, JSON.stringify(value)])).result;
}
async function batch(values, actor = owner) {
  return (await row("select public.taxes_save_batch($1,$2::jsonb) result", [actor, JSON.stringify(values)])).result;
}
async function archive(id, version, actor = owner) {
  return (await row("select public.taxes_archive_record($1,$2,$3) result", [actor, id, version])).result;
}
async function commit(statement, rows, hash = "a".repeat(64), actor = owner, version = statement.version) {
  return (await row("select public.taxes_commit_import($1,$2,$3,$4::jsonb,$5) result", [actor, statement.id, version, JSON.stringify(rows), hash])).result;
}
async function snapshot(year = 2020, fullAudit = false, actor = owner) {
  return (await row("select public.taxes_snapshot($1,$2,$3) result", [actor, year, fullAudit])).result;
}
function business(extra = {}) {
  return { id: randomUUID(), kind: "business", tax_year: null, title: "Soccer club", data: { reporting_treatment: "needs_review" }, ...extra };
}
function statement(extra = {}) {
  return { id: randomUUID(), kind: "statement", tax_year: 2020, title: "May statement", data: { status: "preview", preview: { rows: [] } }, ...extra };
}
function transaction(statementId, data = {}, extra = {}) {
  return { id: randomUUID(), kind: "transaction", tax_year: 2020, title: "Bank transaction", data: {
    date: "2020-05-01", amount_cents: -10000, scope: "unresolved", business_id: null,
    business_percent: 0, deduction_percent: null, review_status: "needs_review", deduction_confirmed: false,
    statement_id: statementId, source_row: 1, ...data,
  }, ...extra };
}

test("tax migration remains repeatable and both tables deny ordinary browser access", async () => {
  await db.exec(migration);
  await db.exec(crossMigration);
  const tables = (await db.query("select relname,relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relname in ('tax_records','tax_audit')")).rows;
  assert.equal(tables.length, 2);
  assert.ok(tables.every(value => value.relrowsecurity));
  for (const browserRole of ["anon", "authenticated"]) {
    await role(browserRole, async () => {
      await denied(() => db.query("select * from public.tax_records"));
      await denied(() => db.query("select * from public.tax_audit"));
      await denied(() => save(business()));
      await denied(() => batch([]));
      await denied(() => archive(randomUUID(), 1));
    });
  }
  const exposed = await row("select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'taxes_%' and (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE') or p.prosecdef)");
  assert.equal(exposed.n, 0, "No public function grants or elevated security-definer functions");
});

test("narrow grants override Supabase defaults and retain append-only audit history", async () => {
  for (const [table, forbidden] of [["tax_records", ["DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]], ["tax_audit", ["UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]]]) {
    for (const privilege of forbidden) {
      assert.equal((await row("select has_table_privilege('service_role',$1,$2) granted", [`public.${table}`, privilege])).granted, false, `${table}: ${privilege}`);
    }
  }
  await role("service_role", async () => {
    const saved = await save(business());
    assert.equal(saved.version, 1);
    await denied(() => db.query("delete from public.tax_records where id=$1", [saved.id]));
    await denied(() => db.query("update public.tax_audit set action='changed' where record_id=$1", [saved.id]));
    await denied(() => db.query("delete from public.tax_audit where record_id=$1", [saved.id]));
  });
});

test("verified active owner and personal allowlist are required, independent of Hub staff privileges", async () => {
  await role("service_role", async () => {
    await denied(() => save(business(), other));
    await denied(() => save(business(), null));
  });
  await db.exec(`insert into public.finance_access(user_id) values('${other}'),('${support}'),('${banned}'),('${unverified}'),('${inactive}') on conflict do nothing`);
  await role("service_role", async () => {
    for (const actor of [support, banned, unverified, inactive]) await denied(() => save(business(), actor));
    assert.ok((await save(business(), other)).id);
  });
});

test("cross-owner record edits and references fail without changing the owner's data", async () => {
  const owned = await save(business());
  await role("service_role", async () => {
    await denied(() => save({ ...business({ id: owned.id }), title: "Hijacked", version: owned.version }, other), ["P0002"]);
    await denied(() => archive(owned.id, owned.version, other), ["P0002"]);
    await denied(() => save(transaction(null, { scope: "business", business_id: owned.id, business_percent: 100 }), other), ["23503"]);
  });
  assert.equal((await row("select title from public.tax_records where id=$1", [owned.id])).title, "Soccer club");
});

test("optimistic versions reject stale, missing and null updates while exact create retries are idempotent", async () => {
  const draft = business();
  const first = await save(draft);
  const repeated = await save(draft);
  assert.equal(repeated.version, 1);
  assert.equal((await row("select count(*)::int n from public.tax_audit where record_id=$1", [first.id])).n, 1);
  await denied(() => save({ ...draft, title: "Missing version" }), ["40001"]);
  const changed = await save({ ...draft, title: "Reviewed title", version: first.version });
  assert.equal(changed.version, 2);
  await denied(() => save({ ...draft, version: first.version }), ["40001"]);
  await denied(() => archive(changed.id, null), ["40001", "22023"]);
  assert.equal((await row("select archived from public.tax_records where id=$1", [first.id])).archived, false);
});

test("failed batches roll back both records and audit entries", async () => {
  const valid = business();
  const invalid = transaction(null, { scope: "business", business_id: randomUUID() });
  await denied(() => batch([valid, invalid]), ["23503"]);
  assert.equal((await row("select count(*)::int n from public.tax_records where id=$1", [valid.id])).n, 0);
  assert.equal((await row("select count(*)::int n from public.tax_audit where record_id=$1", [valid.id])).n, 0);
});

test("bulk classification plus remembered rule commit atomically and honor versions", async()=>{
  const club=await save(business());
  const first=await save(transaction(null,{scope:"unresolved",business_id:null,source_row:undefined}));
  const second=await save(transaction(null,{scope:"unresolved",business_id:null,source_row:undefined}));
  const classify=tx=>({...tx,version:tx.version,data:{...tx.data,scope:"business",business_id:club.id,business_percent:100,category:"other_expenses",review_status:"confirmed",manual_override:true,deduction_confirmed:false,deduction_percent:null,rule_id:null}});
  const rule={id:randomUUID(),kind:"rule",tax_year:null,title:"UPSL classification",data:{match:"UPSL League Fee",match_type:"exact",scope:"business",business_id:club.id,business_percent:100,category:"other_expenses",deduction_confirmed:false,deduction_percent:null,enabled:true,notes:"Synthetic regression test"}};
  const result=await batch([rule,classify(first),classify(second)]);
  assert.equal(result.length,3);
  assert.equal((await row("select count(*)::int n from public.tax_records where id=any($1::uuid[]) and data->>'review_status'='confirmed'",[[first.id,second.id]])).n,2);
  const otherRule={...rule,id:randomUUID(),title:"Second vendor rule"};
  await denied(()=>batch([otherRule,classify(first)]),["40001"]);
  assert.equal((await row("select count(*)::int n from public.tax_records where id=$1",[otherRule.id])).n,0);
  assert.equal((await row("select count(*)::int n from public.tax_audit where record_id=$1",[otherRule.id])).n,0);
});

test("dates and amounts are checked in the database even below route validation", async () => {
  for (const data of [
    { amount_cents: -1.5 }, { amount_cents: 1000000000001 },
    { date: "2021-01-01" }, { date: "2020-02-30" },
    { business_percent: -1 }, { business_percent: 101 }, { deduction_percent: 101 },
  ]) await denied(() => save(transaction(null, data)), ["22023", "22008"]);
});

test("linked original evidence cannot be archived while active records depend on it", async () => {
  const original = await save(statement());
  await save(transaction(original.id));
  await denied(() => archive(original.id, original.version), ["23503"]);
  const event = await save({ id: randomUUID(), kind: "irs_entry", tax_year: 2020, title: "IRS notice", data: { date: "2026-01-01", type: "assessment", amount_cents: 5000, document_id: original.id } });
  assert.ok(event.id);
});

test("statement imports are atomic and same-hash retries cannot create duplicate transactions", async () => {
  const original = await save(statement());
  const input = transaction(original.id);
  const first = await commit(original, [input]);
  assert.equal(first.imported, 1);
  const replay = await commit(original, [input]);
  assert.equal(replay.replayed, true);
  assert.equal((await row("select count(*)::int n from public.tax_records where kind='transaction' and data->>'statement_id'=$1", [original.id])).n, 1);
  await denied(() => commit(original, [input], "b".repeat(64)), ["40001"]);
  const saved = await row("select data from public.tax_records where id=$1", [original.id]);
  assert.equal(saved.data.status, "imported");
});

test("one invalid imported row rolls back the entire selection and preserves review state", async () => {
  const original = await save(statement());
  const good = transaction(original.id);
  const wrongStatement = transaction(randomUUID(), { source_row: 2 });
  await denied(() => commit(original, [good, wrongStatement]), ["22023", "23503"]);
  assert.equal((await row("select count(*)::int n from public.tax_records where id=$1", [good.id])).n, 0);
  assert.equal((await row("select data->>'status' status from public.tax_records where id=$1", [original.id])).status, "preview");
  await denied(() => commit(original, [good], "a".repeat(64), owner, null), ["40001", "22023"]);
});

test("the same source row cannot be imported twice but distinct identical charges are retained", async () => {
  const original = await save(statement());
  const first = transaction(original.id);
  await save(first);
  await denied(() => save(transaction(original.id)), ["23505"]);
  await save(transaction(original.id, { source_row: 2 }));
  assert.equal((await row("select count(*)::int n from public.tax_records where kind='transaction' and data->>'statement_id'=$1", [original.id])).n, 2);
});

test("private document storage stays denied even in the presence of an unrelated broad permissive policy", async () => {
  const bucket = await row("select public,file_size_limit from storage.buckets where id='tax-documents'");
  assert.equal(bucket.public, false);
  assert.equal(Number(bucket.file_size_limit), 20971520);
  const protectedId = randomUUID(), otherId = randomUUID();
  await db.query("insert into storage.objects(id,bucket_id,name) values($1,'tax-documents','statement.pdf'),($2,'public-images','cover.png')", [protectedId, otherId]);
  for (const browserRole of ["anon", "authenticated"]) {
    await role(browserRole, async () => {
      const visible = (await db.query("select id from storage.objects where id in ($1,$2)", [protectedId, otherId])).rows.map(value => value.id);
      assert.deepEqual(visible, [otherId]);
      await denied(() => db.query("insert into storage.objects(bucket_id,name) values('tax-documents','injected.pdf')"));
    });
  }
});

test("full source previews stay out of the audit while record changes remain traceable", async () => {
  const original = await save(statement({ data: { status: "preview", preview: { rows: [{ description: "Large private extraction" }] } } }));
  const audit = await row("select after_state from public.tax_audit where record_id=$1", [original.id]);
  assert.equal(audit.after_state.data.preview, undefined);
  assert.equal(audit.after_state.data.status, "preview");
  assert.equal(audit.after_state.user_id, undefined);
  assert.equal(original.data.preview.rows.length, 1, "Original record retains its reviewable extraction");
});

test("snapshot reads recheck the owner and exclude other owners and other-year transaction details", async () => {
  const owned = await save(transaction(null, { source_row: undefined }, { tax_year: 2020 }));
  const later = await save(transaction(null, { date: "2021-05-01", source_row: undefined }, { tax_year: 2021 }));
  const privateOther = await save(business({ title: "Other owner's private business" }), other);
  await role("service_role", async () => {
    const data = await snapshot();
    assert.ok(data.records.some(value => value.id === owned.id));
    assert.ok(!data.records.some(value => value.id === later.id));
    assert.ok(!data.records.some(value => value.id === privateOther.id));
    assert.ok(data.records.every(value => value.user_id === undefined));
    assert.ok(!data.audit.some(value => value.record_id === privateOther.id));
    await denied(() => snapshot(2020, true, support));
  });
  await role("authenticated", async () => { await denied(() => snapshot()); });
});

test("full export retains all audit events beyond the dashboard limit and supplies before/after evidence", async () => {
  const drafts = Array.from({ length: 105 }, (_, index) => ({ id: randomUUID(), kind: "irs_entry", tax_year: 2018,
    title: `Historical note ${index + 1}`, data: { type: "note", date: "2026-01-01", amount_cents: 0, notes: "Fixture" } }));
  await batch(drafts);
  const initial = await snapshot(2018);
  assert.equal(initial.audit.length, 100);
  assert.ok(initial.audit_total >= 105);
  const full = await snapshot(2018, true);
  assert.equal(full.audit.length, full.audit_total);
  assert.ok(full.audit.every(value => Object.hasOwn(value, "before_state") && Object.hasOwn(value, "after_state")));
  const original = drafts[0];
  await archive(original.id, 1);
  const afterArchive = await snapshot(2018, true);
  const retained = afterArchive.audit.find(value => value.record_id === original.id && value.action === "archived");
  assert.ok(retained.before_state);
  assert.equal(retained.after_state.archived, true);
});

test("stale overlapping-statement imports recheck duplicates atomically, with explicit exceptions preserved", async () => {
  const firstStatement = await save(statement({ title: "First overlap" }));
  const secondStatement = await save(statement({ title: "Second overlap" }));
  const fingerprint = "d".repeat(64);
  const first = transaction(firstStatement.id, { fingerprint });
  const second = transaction(secondStatement.id, { fingerprint });
  await commit(firstStatement, [first]);
  await denied(() => commit(secondStatement, [second]), ["40001"]);
  assert.equal((await row("select count(*)::int n from public.tax_records where id=$1", [second.id])).n, 0);
  assert.equal((await row("select data->>'status' status from public.tax_records where id=$1", [secondStatement.id])).status, "preview");
  const approved = await commit(secondStatement, [{ ...second, allow_duplicate: true }]);
  assert.equal(approved.imported, 1);
  assert.equal((await row("select count(*)::int n from public.tax_records where kind='transaction' and data->>'fingerprint'=$1", [fingerprint])).n, 2);
});

test("existing tax-year records cannot move their history to a different year", async () => {
  const year = await save({ id: randomUUID(), kind: "year", tax_year: 2019, title: "2019", data: { status: "needs_amendment" } });
  await denied(() => save({ id: year.id, version: year.version, kind: "year", tax_year: 2020, title: "2020", data: year.data }), ["22023"]);
  assert.equal((await row("select tax_year from public.tax_records where id=$1", [year.id])).tax_year, 2019);
});

test("one original can import across years and removing it archives rows in every year",async()=>{
  const source=await save(statement({tax_year:2025,title:"January 2025 statement"}));
  const december=transaction(source.id,{date:"2024-12-30",source_row:1},{tax_year:2024});
  const january=transaction(source.id,{date:"2025-01-03",source_row:2},{tax_year:2025});
  const committed=await commit(source,[december,january],"e".repeat(64));
  assert.equal(committed.imported,2);
  const sourceAfter=await row("select version,data from public.tax_records where id=$1",[source.id]);
  assert.deepEqual([...sourceAfter.data.imported_years].sort(),[2024,2025]);
  const prior=await snapshot(2024);
  const later=await snapshot(2025);
  assert.ok(prior.records.some(record=>record.id===december.id));
  assert.ok(later.records.some(record=>record.id===january.id));
  const removed=(await row("select public.taxes_remove_document($1,$2,$3) result",[owner,source.id,sourceAfter.version])).result;
  assert.equal(removed.removed_transactions,2);
  assert.equal((await row("select count(*)::int n from public.tax_records where archived and id=any($1::uuid[])",[[source.id,december.id,january.id]])).n,3);
  assert.equal((await row("select count(*)::int n from public.tax_audit where action='archived' and record_id=any($1::uuid[])",[[source.id,december.id,january.id]])).n,3);
  const after=await snapshot(2024);
  assert.ok(!after.records.some(record=>record.id===december.id));
});
test("duplicate fingerprint lookup stays private and considers all years",async()=>{
  const accountId=randomUUID();
  await save({id:accountId,kind:"account",tax_year:null,title:"Synthetic checking",data:{institution:"Synthetic"}});
  const fingerprint="f".repeat(64);
  await save(transaction(null,{date:"2024-12-01",account_id:accountId,statement_id:null,source_row:undefined,fingerprint},{tax_year:2024}));
  const results=await row("select public.taxes_find_duplicate_fingerprints($1,$2,$3,$4::text[]) matches",[owner,accountId,randomUUID(),[fingerprint,"b".repeat(64)]]);
  assert.deepEqual(results.matches,[fingerprint]);
  await role("authenticated",async()=>{await denied(()=>row("select public.taxes_find_duplicate_fingerprints($1,$2,$3,$4::text[])",[owner,accountId,randomUUID(),[fingerprint]]));});
});
