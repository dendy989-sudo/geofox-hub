import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { financeDate, financeMonth, financeForecastThrough, validateFinanceMutation } from '../../lib/finance/validation.ts';

const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const owner = '10000000-0000-4000-8000-000000000001';
const secondOwner = '10000000-0000-4000-8000-000000000002';
const support = '10000000-0000-4000-8000-000000000003';
const banned = '10000000-0000-4000-8000-000000000004';
const unverified = '10000000-0000-4000-8000-000000000005';
await db.exec(`
  create role anon; create role authenticated; create role service_role bypassrls;
  -- Match Supabase's default service grants when the migration creates tables.
  alter default privileges in schema public grant all on tables to service_role;
  create schema auth;
  create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,banned_until timestamptz,deleted_at timestamptz);
  insert into auth.users(id,email,email_confirmed_at,banned_until) values
  ('${owner}','janna@geofoxapps.com',now(),null),
  ('${secondOwner}','other@example.test',now(),null),
  ('${support}','support@example.test',now(),null),
  ('${banned}','banned@example.test',now(),now()+interval '1 year'),
  ('${unverified}','unverified@example.test',null,null);
`);
await db.exec(await readFile(new URL('../migrations/202611030001_geofox_hub.sql', import.meta.url), 'utf8'));
const bootstrap = await readFile(new URL('../bootstrap_owner.sql', import.meta.url), 'utf8');
await db.exec(bootstrap.replace("owner_email text := 'REPLACE_WITH_YOUR_VERIFIED_COMPANY_EMAIL'", "owner_email text := 'janna@geofoxapps.com'"));
await db.exec(`insert into public.hub_staff(user_id,display_name,role,active) values
 ('${secondOwner}','Other owner','owner',true),('${support}','Support','support',true),
 ('${banned}','Banned','owner',true),('${unverified}','Unverified','owner',true)`);
const migration = await readFile(new URL('../migrations/20261105164728_private_finance_dashboard.sql', import.meta.url), 'utf8');
await db.exec(migration);
assert.equal((await db.query("select has_table_privilege('service_role','public.finance_access','INSERT,UPDATE,DELETE') granted")).rows[0].granted,true,'Fixture must reproduce Supabase default write grants before the follow-up migration');
const readonlyMigration = await readFile(new URL('../migrations/20261105170745_finance_access_service_readonly.sql', import.meta.url), 'utf8');
await db.exec(readonlyMigration);
const customVendorsMigration = await readFile(new URL('../migrations/20261105175613_finance_custom_dates_vendors.sql', import.meta.url), 'utf8');
await db.exec(customVendorsMigration);
const legacyBill=entry(), legacyIncome=entry({kind:'income',title:'Existing income'});
await mutate('save_entry',legacyBill); await mutate('save_entry',legacyIncome);
const legacyPayment={id:randomUUID(),entry_id:legacyBill.id,amount_cents:2000,paid_on:'2026-01-15'};
await mutate('record_payment',legacyPayment);
const accountsMigration = await readFile(new URL('../migrations/20261105184742_finance_accounts_balances_goals.sql', import.meta.url), 'utf8');
await db.exec(accountsMigration);
const legacyDebt=debt({title:'Debt saved before household labels'});
await mutate('save_debt',legacyDebt);
const legacyHouseholdSnapshot=await snapshot();
const householdMigration=await readFile(new URL('../migrations/20261105201038_finance_debt_household_people.sql', import.meta.url), 'utf8');
await db.exec(householdMigration);
const migratedHouseholdSnapshot=await snapshot();
const legacyTagSeries=entry({frequency:'monthly',end_date:'2026-03-31'}), legacyTagPlan=plan();
await mutate('save_entry',legacyTagSeries); await mutate('save_plan',legacyTagPlan);
const legacyTagsSnapshot=await snapshot();
const tagsMigration=await readFile(new URL('../migrations/20261105221524_finance_tags_quarterly_history.sql', import.meta.url), 'utf8');
await db.exec(tagsMigration);
const migratedTagsSnapshot=await snapshot();
async function one(sql, params = []) { return (await db.query(sql, params)).rows[0]; }
async function mutate(action, payload, actor = owner, validate = true) {
  const p = validate ? validateFinanceMutation(action, payload).payload : payload;
  return (await one('select public.finance_mutate($1,$2,$3::jsonb) result',[actor,action,JSON.stringify(p)])).result;
}
async function snapshot(actor = owner, through = '2026-11-30') { return (await one('select public.finance_snapshot($1,$2::date) result', [actor,through])).result; }
async function denied(callback, code = 'P0001') { await assert.rejects(callback, e => e.code === code); }
function entry(extra = {}) { return {id:randomUUID(),kind:'bill',title:'Electricity',category:'Home',expense_type:'bill',amount_cents:10000,original_due_date:'2026-01-15',scheduled_date:'2026-01-15',notes:'',frequency:'once',...extra}; }
function plan(extra = {}) { return {id:randomUUID(),title:'Car repair',creditor:'Repair shop',kind:'installment',category:'Car',total_amount_cents:10001,opening_paid_cents:1000,installment_amount_cents:3000,frequency:'monthly',first_due_date:'2026-01-31',notes:'',...extra}; }
function debt(extra = {}) { return {id:randomUUID(),title:'Old account',stage:'credit_report',original_creditor:'Original company',collector:'Collector',original_balance_cents:10000,current_balance_cents:10000,status:'open',date_added:'2026-01-01',notes:'',...extra}; }
function tag(extra = {}) { return {id:randomUUID(),name:`Tag ${randomUUID()}`,...extra}; }
function vendor(extra = {}) { return {id:randomUUID(),name:`Vendor ${randomUUID()}`,url:'https://example.test/',notes:'',...extra}; }
function account(extra = {}) { return {id:randomUUID(),name:'Daily checking',institution:'Example bank',kind:'checking',last_four:'1234',opening_date:'2026-01-01',opening_balance_cents:100000,credit_limit_cents:null,notes:'',...extra}; }
function transfer(from,to,extra = {}) { return {id:randomUUID(),from_account_id:from,to_account_id:to,amount_cents:10000,date:'2026-01-15',status:'completed',notes:'',...extra}; }
function goal(accountId,extra = {}) { return {id:randomUUID(),account_id:accountId,title:'Emergency savings',target_cents:100000,allocated_cents:0,start_date:'2026-01-01',target_date:null,notes:'',...extra}; }
async function actual(accountId,asOf='2026-11-05',actor=owner) { return Number((await one('select public.finance_actual_account_balance($1,$2,$3::date) balance',[actor,accountId,asOf])).balance); }

// Shared in-memory database is intentional: every write is scoped to a distinct ID.
test('migrations are repeatable under Supabase default grants, all tables use RLS, functions are invokers, browser roles cannot access finance', async () => {
  await db.exec(migration);
  await db.exec(readonlyMigration);
  await db.exec(customVendorsMigration);
  await db.exec(accountsMigration);
  await db.exec(householdMigration); await db.exec(tagsMigration);
  assert.deepEqual((await db.query('select user_id from public.finance_access')).rows.map(r=>r.user_id), [owner]);
  const tables = (await db.query("select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relname like 'finance_%' and relkind='r'")).rows;
  assert.equal(tables.length,17); assert.ok(tables.every(t=>t.relrowsecurity));
  const functions=(await db.query("select proname,prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname like 'finance_%'")).rows;
  assert.equal(functions.length,18); assert.ok(functions.every(f=>f.prosecdef===false));
  for (const role of ['anon','authenticated']) {
    assert.equal((await one("select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname like 'finance_%' and has_function_privilege($1,p.oid,'EXECUTE')",[role])).n,0);
  }
  for (const role of ['anon','authenticated']) {
    await db.exec(`set role ${role}`);
    for (const table of tables) await denied(()=>db.query(`select * from public.${table.relname}`),'42501');
    await denied(()=>snapshot(),'42501');
    await denied(()=>mutate('save_entry',entry()),'42501');
    await db.exec('reset role');
  }
  await db.exec('set role service_role');
  assert.ok(Array.isArray((await snapshot()).entries));
  const serviceEntry=entry(); await mutate('save_entry',serviceEntry);
  await mutate('record_payment',{id:randomUUID(),entry_id:serviceEntry.id,amount_cents:100,paid_on:'2026-01-15'});
  const serviceVendor=vendor(); await mutate('save_vendor',serviceVendor);
  await mutate('save_debt',debt({responsible_people:['Service owner','Household member']}));
  await denied(()=>db.query('delete from public.finance_vendors where id=$1',[serviceVendor.id]),'42501');
  const serviceAccount=account({kind:'savings'}); await mutate('save_account',serviceAccount);
  assert.equal(await actual(serviceAccount.id),100000);
  await mutate('save_goal',goal(serviceAccount.id,{allocated_cents:1000}));
  assert.ok((await snapshot()).entries.some(e=>e.id===serviceEntry.id));
  await db.exec('reset role');
});

test('service role can read the allowlist but cannot insert, update, delete, truncate or administer it', async () => {
  await db.exec('set role service_role');
  try {
    assert.equal((await one('select active from public.finance_access where user_id=$1',[owner])).active,true);
    for (const privilege of ['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) {
      assert.equal((await one("select has_table_privilege('service_role','public.finance_access',$1) granted",[privilege])).granted,false,privilege);
    }
    await denied(()=>db.query('insert into public.finance_access(user_id) values($1)',[secondOwner]),'42501');
    await denied(()=>db.query('update public.finance_access set active=false where user_id=$1',[owner]),'42501');
    await denied(()=>db.query('delete from public.finance_access where user_id=$1',[owner]),'42501');
    await denied(()=>db.query('truncate public.finance_access'),'42501');
  } finally { await db.exec('reset role'); }
});

test('allowlist, verified active owner status, and actor ownership are enforced inside each RPC', async () => {
  await denied(()=>snapshot(secondOwner),'42501');
  await db.exec(`insert into public.finance_access(user_id) values('${secondOwner}'),('${support}'),('${banned}'),('${unverified}')`);
  for (const actor of [support,banned,unverified]) await denied(()=>snapshot(actor),'42501');
  const e = entry(); await mutate('save_entry',e);
  await denied(()=>mutate('move_entry',{id:e.id,scheduled_date:'2026-01-20'},secondOwner),'P0002');
  await denied(()=>mutate('save_entry',{...e,title:'Hijacked'},secondOwner),'23505');
  await denied(()=>mutate('record_payment',{id:randomUUID(),entry_id:e.id,amount_cents:1,paid_on:'2026-01-01'},secondOwner),'P0002');
  assert.ok(!(await snapshot(secondOwner)).entries.some(x=>x.id===e.id));
  await db.query('update public.finance_access set active=false where user_id=$1',[secondOwner]);
  await denied(()=>snapshot(secondOwner),'42501');
  await db.query('update public.finance_access set active=true where user_id=$1',[secondOwner]);
});

test('moves and edits preserve original obligation and cross-month history', async () => {
  const e=entry(); await mutate('save_entry',e);
  await mutate('move_entry',{id:e.id,scheduled_date:'2026-02-20',note:'Requested extension'});
  await mutate('save_entry',{...e,scheduled_date:'2026-02-20',amount_cents:12000});
  const row=await one('select original_due_date::text,scheduled_date::text,original_amount_cents,amount_cents from public.finance_entries where id=$1',[e.id]);
  assert.equal(row.original_due_date,'2026-01-15'); assert.equal(row.scheduled_date,'2026-02-20');
  assert.equal(Number(row.original_amount_cents),10000); assert.equal(Number(row.amount_cents),12000);
  await denied(()=>mutate('save_entry',{...e,original_due_date:'2026-02-20'}));
  assert.equal((await one('select count(*)::int n from public.finance_entry_history where entry_id=$1',[e.id])).n,2);
});

test('partial payment ledger is replay-safe, rejects overpayment/future payments, and supports reversal', async () => {
  const e=entry(); await mutate('save_entry',e);
  const pay={id:randomUUID(),entry_id:e.id,amount_cents:3500,paid_on:'2026-01-15',note:'Partial'};
  await mutate('record_payment',pay); await mutate('record_payment',pay);
  assert.equal((await one('select count(*)::int n from public.finance_payments where entry_id=$1',[e.id])).n,1);
  await denied(()=>mutate('record_payment',{...pay,amount_cents:4500}));
  await denied(()=>mutate('record_payment',{...pay,id:randomUUID(),amount_cents:6501}));
  await denied(()=>mutate('record_payment',{...pay,id:randomUUID(),paid_on:'2100-01-01'}));
  await mutate('record_payment',{...pay,id:randomUUID(),amount_cents:6500});
  await denied(()=>mutate('save_entry',{...e,amount_cents:9999}));
  await mutate('remove_payment',{id:pay.id}); await mutate('remove_payment',{id:pay.id});
  await mutate('record_payment',pay);
  assert.equal(Number((await one('select sum(amount_cents) paid from public.finance_payments where entry_id=$1 and reversed_at is null',[e.id])).paid),6500);
  await mutate('entry_status',{id:e.id,status:'cancelled',archived:true});
  await denied(()=>mutate('record_payment',{...pay,id:randomUUID(),amount_cents:1000}));
  const s=await snapshot(); assert.ok(s.entries.some(x=>x.id===e.id && x.archived_at));
  assert.equal(s.payments.filter(p=>p.entry_id===e.id).length,2,'Inactive entry cash history stays resolvable');
});

test('recurrence uses anchored dates, inclusive end dates and never resurrects cancelled occurrences', async () => {
  const e=entry({title:'Monthly rent',original_due_date:'2026-01-31',scheduled_date:'2026-01-31',frequency:'monthly',end_date:'2026-03-31'});
  await mutate('save_entry',e);
  const initial=(await snapshot(owner,'2026-04-30')).entries.find(x=>x.id===e.id);
  const series=initial.series_id;
  const children=(await snapshot(owner,'2026-04-30')).entries.filter(x=>x.series_id===series);
  assert.deepEqual(children.map(x=>x.original_due_date),['2026-01-31','2026-02-28','2026-03-31']);
  await mutate('entry_status',{id:children[1].id,status:'cancelled',archived:true});
  assert.equal((await snapshot(owner,'2026-04-30')).entries.filter(x=>x.series_id===series).length,3);
  assert.equal((await snapshot(owner,'2026-04-30')).entries.find(x=>x.id===children[1].id).status,'cancelled');
  assert.equal((await one("select public.finance_occurrence_date('2024-02-29','yearly',1)::text d")).d,'2025-02-28');
  assert.equal((await one("select public.finance_occurrence_date('2024-02-29','yearly',4)::text d")).d,'2028-02-29');
  const income=entry({kind:'income',title:'Paycheck',frequency:'biweekly',original_due_date:'2026-10-02',scheduled_date:'2026-10-02'});
  await mutate('save_entry',income);
  const iseries=(await snapshot(owner,'2026-10-31')).entries.find(x=>x.id===income.id).series_id;
  assert.deepEqual((await snapshot(owner,'2026-10-31')).entries.filter(x=>x.series_id===iseries).map(x=>x.original_due_date),['2026-10-02','2026-10-16','2026-10-30']);
  await mutate('save_series',{id:iseries,active:false});
  assert.equal((await snapshot(owner,'2026-11-30')).entries.filter(x=>x.series_id===iseries).length,3);
  await mutate('save_series',{id:iseries,active:true});
  assert.equal((await snapshot(owner,'2026-11-30')).entries.filter(x=>x.series_id===iseries).length,5);
});

test('payment plans create exact installments and cancellation preserves manual decisions', async () => {
  const p=plan({title:'X'.repeat(200)}); await mutate('save_plan',p); await mutate('save_plan',p);
  let items=(await snapshot()).entries.filter(e=>e.plan_id===p.id);
  assert.equal(items.length,4); assert.deepEqual(items.map(e=>e.amount_cents),[3000,3000,3000,1]);
  assert.deepEqual(items.map(e=>e.original_due_date),['2026-01-31','2026-02-28','2026-03-31','2026-04-30']);
  await mutate('record_payment',{id:randomUUID(),entry_id:items[0].id,amount_cents:3000,paid_on:'2026-01-31'});
  await mutate('entry_status',{id:items[1].id,status:'cancelled'});
  await mutate('plan_status',{id:p.id,status:'cancelled'});
  items=(await snapshot()).entries.filter(e=>e.plan_id===p.id);
  assert.deepEqual(items.map(e=>e.status),['active','cancelled','cancelled','cancelled']);
  await mutate('plan_status',{id:p.id,status:'active'});
  assert.deepEqual((await snapshot()).entries.filter(e=>e.plan_id===p.id).map(e=>e.status),['active','cancelled','active','active']);
  await denied(()=>mutate('save_plan',{...p,total_amount_cents:20000}));
  await denied(()=>mutate('save_plan',plan({total_amount_cents:241,opening_paid_cents:0,installment_amount_cents:1}),owner,false),'23514');
});

test('collections transfer only unpaid principal once and payment reversals restore its remaining debt', async () => {
  const e=entry(); await mutate('save_entry',e);
  const payment={id:randomUUID(),entry_id:e.id,amount_cents:2500,paid_on:'2026-01-15'}; await mutate('record_payment',payment);
  const transfer={id:randomUUID(),entry_id:e.id,collector:'Collection agency',notes:'Contact by mail'};
  const first=await mutate('transfer_collections',transfer); const replay=await mutate('transfer_collections',transfer);
  assert.equal(first.id,replay.id);
  assert.equal((await snapshot()).debts.find(d=>d.id===first.id).current_balance_cents,7500);
  assert.equal((await snapshot()).entries.find(x=>x.id===e.id).status,'collections');
  await denied(()=>mutate('record_payment',{...payment,id:randomUUID(),amount_cents:1000}));
  await mutate('remove_payment',{id:payment.id}); await mutate('remove_payment',{id:payment.id});
  assert.equal((await snapshot()).debts.find(d=>d.id===first.id).current_balance_cents,10000);
  assert.equal((await snapshot()).debts.filter(d=>d.source_entry_id===e.id).length,1);
  const p=plan(); await mutate('save_plan',p);
  const children=(await snapshot()).entries.filter(x=>x.plan_id===p.id);
  const planPayment={id:randomUUID(),entry_id:children[0].id,amount_cents:3000,paid_on:'2026-01-31'};
  await mutate('record_payment',planPayment);
  const moved=await mutate('transfer_collections',{id:randomUUID(),plan_id:p.id,collector:'Collector'});
  assert.equal((await snapshot()).debts.find(d=>d.id===moved.id).current_balance_cents,6001);
  assert.equal((await snapshot()).plans.find(x=>x.id===p.id).status,'collections');
  assert.equal((await snapshot()).entries.filter(x=>x.plan_id===p.id && x.status==='collections').length,3);
  await mutate('remove_payment',{id:planPayment.id});
  assert.equal((await snapshot()).debts.find(d=>d.id===moved.id).current_balance_cents,9001);
  assert.equal((await snapshot()).entries.find(x=>x.id===children[0].id).status,'collections');
});

test('debt updates retain balance and offer history and paid requires zero balance', async () => {
  const d=debt(); await mutate('save_debt',d);
  await mutate('save_debt',{...d,current_balance_cents:9500,settlement_offer_cents:5000,offer_monthly_cents:500,change_note:'Letter received'});
  const s=await snapshot(); const history=s.debt_history.filter(h=>h.debt_id===d.id);
  assert.equal(history.length,2); assert.ok(history.some(h=>h.previous_balance_cents===10000 && h.balance_cents===9500 && h.note==='Letter received'));
  await denied(()=>mutate('save_debt',{...d,original_balance_cents:9000}));
  await denied(()=>mutate('save_debt',{...d,status:'paid'},owner,false),'23514');
  await mutate('save_debt',{...d,status:'charged_off'});
  assert.equal((await snapshot()).debts.find(x=>x.id===d.id).current_balance_cents,10000);
  await mutate('save_debt',{...d,status:'paid',current_balance_cents:0,date_removed:'2026-02-01'});
  assert.equal((await snapshot()).debts.find(x=>x.id===d.id).status,'paid');
});

test('monthly starting balances and spending scenarios are independent, scoped and resettable', async () => {
  const before=(await snapshot()).entries.length;
  await mutate('save_month',{month:'2026-01',opening_balance_cents:-2500});
  const jan={id:randomUUID(),title:'Try a purchase',date:'2026-01-20',amount_cents:20000};
  const feb={...jan,id:randomUUID(),date:'2026-02-01'};
  await mutate('save_spending',jan); await mutate('save_spending',jan); await mutate('save_spending',feb);
  await mutate('save_spending',jan,secondOwner).then(()=>assert.fail('Must not overwrite another owner'),e=>assert.equal(e.code,'P0002'));
  await mutate('clear_spending',{month:'2026-01'});
  let s=await snapshot(); assert.equal(s.entries.length,before); assert.ok(!s.spending.some(x=>x.id===jan.id)); assert.ok(s.spending.some(x=>x.id===feb.id));
  assert.equal(s.months.find(m=>m.month==='2026-01').opening_balance_cents,-2500);
  await mutate('remove_spending',{id:feb.id}); await mutate('remove_spending',{id:feb.id});
  s=await snapshot(); assert.ok(!s.spending.some(x=>x.id===feb.id));
});

test('API validation rejects impossible dates, fractional cents, nonfinite values and forged fields', () => {
  for(const date of ['2026-02-29','2026-02-30','2026-13-01','1900-01-01','2101-01-01']) assert.throws(()=>financeDate(date));
  assert.equal(financeDate('2024-02-29'),'2024-02-29');
  for(const month of ['2026-00','2026-13','2026-1','2026-01-01']) assert.throws(()=>financeMonth(month));
  for(const amount of [0,-1,1.1,Infinity,NaN,Number.MAX_SAFE_INTEGER]) assert.throws(()=>validateFinanceMutation('save_entry',entry({amount_cents:amount})));
  assert.throws(()=>validateFinanceMutation('record_payment',{entry_id:randomUUID(),amount_cents:100,paid_on:'2026-01-01'}));
  assert.throws(()=>validateFinanceMutation('transfer_collections',{entry_id:randomUUID(),plan_id:randomUUID(),collector:'X'}));
  assert.throws(()=>validateFinanceMutation('save_debt',debt({status:'paid'})));
  assert.throws(()=>validateFinanceMutation('save_plan',plan({opening_paid_cents:10002})));
  const clean=validateFinanceMutation('save_entry',entry({user_id:secondOwner,status:'paid',original_amount_cents:1})).payload;
  assert.equal(clean.user_id,undefined); assert.equal(clean.status,undefined); assert.equal(clean.original_amount_cents,undefined);
});

test('mutation failures roll back their entire plan, transfer and reversal transaction', async () => {
  const p=plan({first_due_date:'2100-11-30'});
  await denied(()=>mutate('save_plan',p),'23514');
  assert.equal((await one('select count(*)::int n from public.finance_plans where id=$1',[p.id])).n,0);
  assert.equal((await one('select count(*)::int n from public.finance_entries where plan_id=$1',[p.id])).n,0);
  const occupied=debt(); await mutate('save_debt',occupied);
  const e=entry(); await mutate('save_entry',e);
  const payment={id:randomUUID(),entry_id:e.id,amount_cents:2500,paid_on:'2026-01-15'};
  await mutate('record_payment',payment);
  await denied(()=>mutate('transfer_collections',{id:occupied.id,entry_id:e.id,collector:'Collector'}),'23505');
  assert.equal((await snapshot()).entries.find(x=>x.id===e.id).status,'active');
  assert.equal((await snapshot()).debts.filter(d=>d.source_entry_id===e.id).length,0);
  const transferred=await mutate('transfer_collections',{id:randomUUID(),entry_id:e.id,collector:'Collector'});
  const stored=(await snapshot()).debts.find(d=>d.id===transferred.id);
  await mutate('save_debt',{...stored,current_balance_cents:1_000_000_000_000});
  await denied(()=>mutate('remove_payment',{id:payment.id}),'23514');
  assert.equal((await snapshot()).payments.find(x=>x.id===payment.id).reversed_at,null);
  assert.equal((await snapshot()).debts.find(x=>x.id===stored.id).current_balance_cents,1_000_000_000_000);
});

test('reversals honor cancelled plans and prioritize an individually transferred installment', async () => {
  const p=plan(); await mutate('save_plan',p);
  const children=(await snapshot()).entries.filter(x=>x.plan_id===p.id);
  const paid={id:randomUUID(),entry_id:children[0].id,amount_cents:3000,paid_on:'2026-01-31'};
  await mutate('record_payment',paid);
  await mutate('plan_status',{id:p.id,status:'cancelled'});
  await mutate('remove_payment',{id:paid.id});
  assert.equal((await snapshot()).entries.find(x=>x.id===children[0].id).status,'cancelled');
  await mutate('plan_status',{id:p.id,status:'active'});
  const partial={id:randomUUID(),entry_id:children[0].id,amount_cents:1000,paid_on:'2026-01-31'};
  await mutate('record_payment',partial);
  const individual=await mutate('transfer_collections',{id:randomUUID(),entry_id:children[0].id,collector:'First agency'});
  const rest=await mutate('transfer_collections',{id:randomUUID(),plan_id:p.id,collector:'Second agency'});
  await mutate('remove_payment',{id:partial.id});
  const s=await snapshot();
  assert.equal(s.debts.find(d=>d.id===individual.id).current_balance_cents,3000);
  assert.equal(s.debts.find(d=>d.id===rest.id).current_balance_cents,6001);
});

test('the recurring forecast horizon consistently includes five months ahead', () => {
  assert.equal(financeForecastThrough('2026-01','2026-11'),'2027-04-30');
  assert.equal(financeForecastThrough('2028-02','2026-11'),'2028-02-29');
  assert.equal(financeForecastThrough('2100-11','2100-10'),'2100-12-31');
});

test.after(async()=>{await db.close();});


test('archiving preserves parent cancellation and permits archiving paid children of inactive plans', async () => {
  const p=plan(); await mutate('save_plan',p);
  let children=(await snapshot()).entries.filter(e=>e.plan_id===p.id);
  await mutate('record_payment',{id:randomUUID(),entry_id:children[0].id,amount_cents:children[0].amount_cents,paid_on:'2026-01-31'});
  await mutate('plan_status',{id:p.id,status:'cancelled'});
  await mutate('entry_status',{id:children[1].id,status:'cancelled',archived:true});
  assert.equal((await one('select cancelled_by_plan from public.finance_entries where id=$1',[children[1].id])).cancelled_by_plan,true);
  await mutate('entry_status',{id:children[0].id,status:'active',archived:true});
  await mutate('plan_status',{id:p.id,status:'active'});
  const restored=(await snapshot()).entries.find(e=>e.id===children[1].id);
  assert.equal(restored.status,'active'); assert.ok(restored.archived_at);
  await mutate('entry_status',{id:children[1].id,status:'active',archived:false});
  assert.equal((await snapshot()).entries.find(e=>e.id===children[1].id).archived_at,null);

  const collected=plan(); await mutate('save_plan',collected);
  children=(await snapshot()).entries.filter(e=>e.plan_id===collected.id);
  await mutate('record_payment',{id:randomUUID(),entry_id:children[0].id,amount_cents:children[0].amount_cents,paid_on:'2026-01-31'});
  await mutate('transfer_collections',{plan_id:collected.id,collector:'Plan collector'});
  await mutate('entry_status',{id:children[0].id,status:'active',archived:true});
  assert.ok((await snapshot()).entries.find(e=>e.id===children[0].id).archived_at);
});

test('custom recurrence validation normalizes selections and rejects impossible or incomplete schedules', () => {
  const monthly=entry({frequency:'custom',custom_mode:'month_days',custom_month_days:[31,15,1,15]});
  assert.deepEqual(validateFinanceMutation('save_entry',monthly).payload.custom_month_days,[1,15,31]);
  const leap=entry({frequency:'custom',custom_mode:'month_days',custom_month_days:[30,31],original_due_date:'2028-02-29',scheduled_date:'2028-02-29'});
  assert.equal(validateFinanceMutation('save_entry',leap).payload.custom_mode,'month_days');
  for (const days of [[],[0],[32],[1.5],['15'],[null],[1,31]]) assert.throws(()=>validateFinanceMutation('save_entry',{...monthly,custom_month_days:days}));
  const specific={...monthly,custom_mode:'specific_dates',custom_dates:['2026-02-03','2026-01-15','2026-02-03'],end_date:'2026-02-03'};
  assert.deepEqual(validateFinanceMutation('save_entry',specific).payload.custom_dates,['2026-01-15','2026-02-03']);
  for (const dates of [['2026-01-15','2026-02-04'],['2026-01-15','2026-02-30']]) {
    assert.throws(()=>validateFinanceMutation('save_entry',{...specific,custom_dates:dates}));
  }
  const tooMany=Array.from({length:241},(_,i)=>new Date(Date.UTC(2026,0,15+i,12)).toISOString().slice(0,10));
  assert.throws(()=>validateFinanceMutation('save_entry',{...specific,custom_dates:tooMany,end_date:null}),/240/);
});

test('custom month days clamp and deduplicate month ends while preserving moved, cancelled and edited occurrences', async () => {
  const e=entry({frequency:'custom',custom_mode:'month_days',custom_month_days:[31,1,30,15,30],original_due_date:'2026-01-30',scheduled_date:'2026-01-30',end_date:'2026-04-30'});
  await mutate('save_entry',e);
  let s=await snapshot(owner,'2026-02-28'); const series=s.entries.find(x=>x.id===e.id).series_id;
  let children=s.entries.filter(x=>x.series_id===series);
  assert.deepEqual(children.map(x=>x.original_due_date),['2026-01-30','2026-01-31','2026-02-01','2026-02-15','2026-02-28']);
  const moved=children.find(x=>x.original_due_date==='2026-02-28');
  const cancelled=children.find(x=>x.original_due_date==='2026-01-31');
  const edited=children.find(x=>x.original_due_date==='2026-02-15');
  await mutate('move_entry',{id:moved.id,scheduled_date:'2026-03-08'});
  await mutate('entry_status',{id:cancelled.id,status:'cancelled'});
  await mutate('save_entry',{...edited,frequency:'once',amount_cents:12345});
  s=await snapshot(owner,'2026-05-31'); children=s.entries.filter(x=>x.series_id===series);
  assert.deepEqual(children.map(x=>x.original_due_date),['2026-01-30','2026-01-31','2026-02-01','2026-02-15','2026-02-28','2026-03-01','2026-03-15','2026-03-30','2026-03-31','2026-04-01','2026-04-15','2026-04-30']);
  assert.equal(children.find(x=>x.id===moved.id).scheduled_date,'2026-03-08');
  assert.equal(children.find(x=>x.id===cancelled.id).status,'cancelled');
  assert.equal(children.find(x=>x.id===edited.id).amount_cents,12345);
  assert.deepEqual(s.series.find(x=>x.id===series).custom_month_days,[1,15,30,31]);
  const leap=entry({frequency:'custom',custom_mode:'month_days',custom_month_days:[29,30,31],original_due_date:'2028-02-29',scheduled_date:'2028-02-29',end_date:'2028-03-31'});
  await mutate('save_entry',leap); s=await snapshot(owner,'2028-04-30');
  const leapSeries=s.entries.find(x=>x.id===leap.id).series_id;
  assert.deepEqual(s.entries.filter(x=>x.series_id===leapSeries).map(x=>x.original_due_date),['2028-02-29','2028-03-29','2028-03-30','2028-03-31']);
});

test('specific-date income is finite, sorted, pauseable and independent of payment rescheduling', async () => {
  const e=entry({kind:'income',frequency:'custom',custom_mode:'specific_dates',custom_dates:['2026-12-31','2026-01-15','2026-02-03','2026-02-03'],end_date:'2026-12-31'});
  await mutate('save_entry',e); let s=await snapshot(owner,'2026-02-28');
  const series=s.entries.find(x=>x.id===e.id).series_id;
  assert.deepEqual(s.series.find(x=>x.id===series).custom_dates,['2026-01-15','2026-02-03','2026-12-31']);
  assert.equal(s.entries.filter(x=>x.series_id===series).length,2);
  const feb=s.entries.find(x=>x.series_id===series && x.original_due_date==='2026-02-03');
  await mutate('move_entry',{id:feb.id,scheduled_date:'2026-03-05'});
  await mutate('save_series',{id:series,active:false});
  assert.equal((await snapshot(owner,'2027-12-31')).entries.filter(x=>x.series_id===series).length,2);
  await mutate('save_series',{id:series,active:true}); s=await snapshot(owner,'2027-12-31');
  assert.deepEqual(s.entries.filter(x=>x.series_id===series).map(x=>x.original_due_date),['2026-01-15','2026-02-03','2026-12-31']);
  assert.equal(s.entries.find(x=>x.id===feb.id).scheduled_date,'2026-03-05');
});

test('SQL validates custom schedules independently and rolls back inline vendors when recurrence fails', async () => {
  const badVendor=vendor();
  const bad=entry({frequency:'custom',custom_mode:'month_days',custom_month_days:[31],new_vendor:badVendor});
  await denied(()=>mutate('save_entry',bad,owner,false));
  assert.equal((await one('select count(*)::int n from public.finance_vendors where id=$1',[badVendor.id])).n,0);
  assert.equal((await one('select count(*)::int n from public.finance_entries where id=$1',[bad.id])).n,0);
  for (const days of [[],[0],[32],['15'],[null]]) {
    await assert.rejects(()=>mutate('save_entry',entry({frequency:'custom',custom_mode:'month_days',custom_month_days:days}),owner,false));
  }
  for (const dates of [['2026-01-15','2026-02-04'],['today']]) {
    await assert.rejects(()=>mutate('save_entry',entry({frequency:'custom',custom_mode:'specific_dates',custom_dates:dates,end_date:'2026-02-03'}),owner,false));
  }
  const tooMany=Array.from({length:241},(_,i)=>new Date(Date.UTC(2026,0,15+i,12)).toISOString().slice(0,10));
  await denied(()=>mutate('save_entry',entry({frequency:'custom',custom_mode:'specific_dates',custom_dates:tooMany}),owner,false));
  const valid=entry({frequency:'custom',custom_mode:'month_days',custom_month_days:[31,15,15]});
  await mutate('save_entry',valid,owner,false);
  const linked=(await snapshot()).entries.find(x=>x.id===valid.id);
  assert.deepEqual((await snapshot()).series.find(x=>x.id===linked.series_id).custom_month_days,[15,31]);
  await denied(()=>db.query("update public.finance_series set custom_month_days=array[0,15] where id=$1",[linked.series_id]),'23514');
});

test('vendor names are normalized and unique per owner, with helpful duplicate errors and retained archives', async () => {
  const suffix=randomUUID(); const v=vendor({name:`  Example   Utility ${suffix}  `,url:'example.test/account'});
  await mutate('save_vendor',v);
  let row=(await snapshot()).vendors.find(x=>x.id===v.id);
  assert.equal(row.name,`Example Utility ${suffix}`); assert.equal(row.url,'https://example.test/account');
  await assert.rejects(()=>mutate('save_vendor',vendor({name:`example utility ${suffix}`})),/already exists/);
  await mutate('save_vendor',{...v,name:row.name,notes:'Customer reference 123',url:null});
  await mutate('vendor_status',{id:v.id,archived:true});
  row=(await snapshot()).vendors.find(x=>x.id===v.id);
  assert.ok(row.archived_at); assert.equal(row.notes,'Customer reference 123'); assert.equal(row.url,null);
  await assert.rejects(()=>mutate('save_vendor',vendor({name:row.name.toUpperCase()})),/restore it if archived/);
  await mutate('save_vendor',vendor({name:row.name}),secondOwner);
  assert.ok(!(await snapshot(secondOwner)).vendors.some(x=>x.id===v.id));
});

test('inline vendor creation is atomic and replay-safe for bills and payment plans', async () => {
  const v=vendor(); const e=entry({new_vendor:v,frequency:'monthly',end_date:'2026-03-31'});
  await mutate('save_entry',e); await mutate('save_entry',e);
  let s=await snapshot(); const row=s.entries.find(x=>x.id===e.id);
  assert.equal(s.vendors.filter(x=>x.id===v.id).length,1);
  assert.equal(row.vendor_id,v.id); assert.equal(s.series.find(x=>x.id===row.series_id).vendor_id,v.id);
  assert.ok(s.entries.filter(x=>x.series_id===row.series_id).every(x=>x.vendor_id===v.id));
  const planVendor=vendor(); const p=plan({new_vendor:planVendor});
  await mutate('save_plan',p); await mutate('save_plan',p); s=await snapshot();
  assert.equal(s.plans.find(x=>x.id===p.id).vendor_id,planVendor.id);
  assert.equal(s.entries.filter(x=>x.plan_id===p.id).length,4);
  assert.ok(s.entries.filter(x=>x.plan_id===p.id).every(x=>x.vendor_id===planVendor.id));
  const failedVendor=vendor();
  await denied(()=>mutate('save_plan',{...p,total_amount_cents:p.total_amount_cents+1,new_vendor:failedVendor}));
  assert.equal((await one('select count(*)::int n from public.finance_vendors where id=$1',[failedVendor.id])).n,0);
  const badEntryVendor=vendor();
  await denied(()=>mutate('save_entry',entry({new_vendor:badEntryVendor,amount_cents:-1}),owner,false),'23514');
  assert.equal((await one('select count(*)::int n from public.finance_vendors where id=$1',[badEntryVendor.id])).n,0);
});

test('vendor ownership is enforced by actions, snapshots and composite foreign keys', async () => {
  const v=vendor(); await mutate('save_vendor',v,secondOwner);
  await denied(()=>mutate('save_vendor',{...v,name:'Hijack'}),'P0002');
  await denied(()=>mutate('vendor_status',{id:v.id,archived:true}),'P0002');
  await denied(()=>mutate('save_entry',entry({vendor_id:v.id})),'P0002');
  await denied(()=>mutate('save_entry',entry({new_vendor:v})),'P0002');
  await denied(()=>mutate('save_plan',plan({vendor_id:v.id})),'P0002');
  assert.ok(!(await snapshot()).vendors.some(x=>x.id===v.id));
  for (const table of ['finance_entries','finance_series','finance_plans']) {
    const owned=await one(`select id from public.${table} where user_id=$1 limit 1`,[owner]);
    await denied(()=>db.query(`update public.${table} set vendor_id=$1 where id=$2`,[v.id,owned.id]),'23503');
  }
});

test('archived vendors retain existing links, reject new assignments and remain available to history', async () => {
  const v=vendor(); await mutate('save_vendor',v);
  const e=entry({vendor_id:v.id,frequency:'monthly',end_date:'2026-12-31'}); const p=plan({vendor_id:v.id});
  await mutate('save_entry',e); await mutate('save_plan',p); await mutate('vendor_status',{id:v.id,archived:true});
  const {vendor_id:omitted,...olderPayload}=e;
  await mutate('save_entry',{...olderPayload,title:'Edited by older client'});
  await mutate('save_entry',{...e,title:'Preserve existing archived link'});
  const {vendor_id:omittedPlan,...olderPlan}=p; await mutate('save_plan',{...olderPlan,notes:'Older client edit'});
  await denied(()=>mutate('save_entry',entry({vendor_id:v.id})));
  await denied(()=>mutate('save_plan',plan({vendor_id:v.id})));
  let s=await snapshot(owner,'2026-12-31'); const series=s.entries.find(x=>x.id===e.id).series_id;
  assert.ok(s.entries.filter(x=>x.series_id===series).every(x=>x.vendor_id===v.id));
  assert.equal(s.plans.find(x=>x.id===p.id).vendor_id,v.id);
  assert.ok(s.vendors.find(x=>x.id===v.id).archived_at);
  await mutate('save_entry',{...e,vendor_id:null});
  await denied(()=>mutate('save_entry',e));
  await mutate('vendor_status',{id:v.id,archived:false}); await mutate('save_entry',e);
  assert.equal((await snapshot()).entries.find(x=>x.id===e.id).vendor_id,v.id);
});

test('occurrence vendor edits stay local and plan vendor changes carry paid, cancelled and transferred history', async () => {
  const first=vendor(),second=vendor(); await mutate('save_vendor',first); await mutate('save_vendor',second);
  const e=entry({vendor_id:first.id,frequency:'monthly',end_date:'2026-03-31'}); await mutate('save_entry',e);
  await mutate('save_entry',{...e,vendor_id:second.id});
  let s=await snapshot(); const series=s.entries.find(x=>x.id===e.id).series_id;
  assert.equal(s.series.find(x=>x.id===series).vendor_id,first.id);
  assert.ok(s.entries.filter(x=>x.series_id===series && x.id!==e.id).every(x=>x.vendor_id===first.id));
  const p=plan({vendor_id:first.id}); await mutate('save_plan',p);
  let children=(await snapshot()).entries.filter(x=>x.plan_id===p.id);
  const payment={id:randomUUID(),entry_id:children[0].id,amount_cents:children[0].amount_cents,paid_on:'2026-01-31'};
  await mutate('record_payment',payment);
  await mutate('entry_status',{id:children[1].id,status:'cancelled'});
  await mutate('transfer_collections',{entry_id:children[2].id,collector:'Installment collector'});
  await mutate('save_entry',{...children[0],vendor_id:null});
  await mutate('save_plan',{...p,notes:'Unchanged vendor must preserve a detached child'});
  assert.equal((await snapshot()).entries.find(x=>x.id===children[0].id).vendor_id,null);
  const {vendor_id:ignored,...oldPlan}=p; await mutate('save_plan',{...oldPlan,notes:'Omitted vendor also preserves it'});
  assert.equal((await snapshot()).entries.find(x=>x.id===children[0].id).vendor_id,null);
  await mutate('save_plan',{...p,vendor_id:second.id}); s=await snapshot();
  children=s.entries.filter(x=>x.plan_id===p.id);
  assert.ok(children.every(x=>x.vendor_id===second.id));
  assert.equal(children[1].status,'cancelled'); assert.equal(children[2].status,'collections');
  assert.equal(s.payments.find(x=>x.id===payment.id).amount_cents,payment.amount_cents);
  assert.equal((await one("select count(*)::int n from public.finance_entry_history where action='vendor_changed' and details->>'plan_id'=$1",[p.id])).n,4);
  await mutate('remove_payment',{id:payment.id}); s=await snapshot();
  assert.ok(s.payments.find(x=>x.id===payment.id).reversed_at);
  assert.equal(s.entries.find(x=>x.id===payment.entry_id).vendor_id,second.id);
  await mutate('save_plan',{...p,vendor_id:null});
  assert.ok((await snapshot()).entries.filter(x=>x.plan_id===p.id).every(x=>x.vendor_id===null));
});

test('SQL rejects unsafe vendor URLs and treats SQL-like names and URLs as data', async () => {
  const invalid=['javascript:alert(1)','data:text/html,test','ftp://example.test','//example.test','/relative','https:example.test','https://user:pass@example.test','https://example.test\\evil','https://exam ple.test','https://example.test/\nlogin','https://-bad.test','https://bad..test','https://example.test:70000','https://999.999.999.999'];
  for (const url of invalid) {
    const v=vendor({url}); await assert.rejects(()=>mutate('save_vendor',v,owner,false),undefined,url);
    assert.equal((await one('select count(*)::int n from public.finance_vendors where id=$1',[v.id])).n,0);
  }
  const raw=vendor({url:'example.test/pay'}); await mutate('save_vendor',raw,owner,false);
  assert.equal((await snapshot()).vendors.find(x=>x.id===raw.id).url,'https://example.test/pay');
  const injection=vendor({name:`O'Brien; DROP TABLE finance_entries; -- ${randomUUID()}`,url:"https://example.test/pay?q=';DROP_TABLE"});
  await mutate('save_vendor',injection,owner,false);
  assert.equal((await one('select name from public.finance_vendors where id=$1',[injection.id])).name,injection.name);
  assert.ok((await one('select count(*)::int n from public.finance_entries')).n>0);
  const own=vendor(); await mutate('save_vendor',own);
  await assert.rejects(()=>mutate('save_entry',entry({vendor_id:own.id,new_vendor:vendor()})),/not both/);
  await denied(()=>mutate('save_entry',entry({vendor_id:own.id,new_vendor:vendor()}),owner,false));
});

test('custom/vendor migration can be reapplied with financial history and preserves private grants', async () => {
  const before=await snapshot(); await db.exec(customVendorsMigration); await db.exec(accountsMigration); await db.exec(householdMigration); await db.exec(tagsMigration); const after=await snapshot();
  assert.deepEqual(after,before);
  assert.equal((await one("select has_table_privilege('service_role','public.finance_access','INSERT,UPDATE,DELETE') granted")).granted,false);
  assert.equal((await one("select has_table_privilege('service_role','public.finance_vendors','DELETE,TRUNCATE,TRIGGER,REFERENCES') granted")).granted,false);
  assert.equal((await one("select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname like 'finance_%' and (prosecdef or has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE'))")).n,0);
});

test('account migration preserves legacy cash history and backfills reminders only once', async () => {
  let s=await snapshot();
  assert.equal(s.entries.find(e=>e.id===legacyBill.id).reminder_days,3);
  assert.equal(s.entries.find(e=>e.id===legacyIncome.id).reminder_days,null);
  const p=s.payments.find(p=>p.id===legacyPayment.id);
  assert.equal(p.account_id,null); assert.equal(p.payment_method,'manual'); assert.equal(p.amount_cents,2000);
  await mutate('save_entry',{...legacyBill,reminder_days:null});
  await mutate('save_entry',{...legacyIncome,reminder_days:5});
  await db.exec(accountsMigration); await db.exec(householdMigration); await db.exec(tagsMigration); s=await snapshot();
  assert.equal(s.entries.find(e=>e.id===legacyBill.id).reminder_days,null);
  assert.equal(s.entries.find(e=>e.id===legacyIncome.id).reminder_days,5);
  const a=account(); await mutate('save_account',a);
  await mutate('save_entry',{...legacyBill,account_id:a.id,payment_method:'autopay'});
  await mutate('record_payment',legacyPayment);
  assert.equal(await actual(a.id),100000,'An old unassigned payment must not move when its bill gets an account');
  assert.equal((await snapshot()).payments.find(p=>p.id===legacyPayment.id).account_id,null);
});

test('account, method, reminder, transfer and goal input validation rejects ambiguous financial input', () => {
  assert.equal(validateFinanceMutation('save_account',account({opening_balance_cents:-2500})).payload.opening_balance_cents,-2500);
  for (const last_four of ['123','12345','12x4']) assert.throws(()=>validateFinanceMutation('save_account',account({last_four})));
  assert.throws(()=>validateFinanceMutation('save_account',account({credit_limit_cents:10000})));
  assert.throws(()=>validateFinanceMutation('save_entry',entry({kind:'income',payment_method:'autopay'})));
  assert.throws(()=>validateFinanceMutation('save_entry',entry({payment_method:'direct_deposit'})));
  for (const reminder_days of [-1,31,1.5,'3']) assert.throws(()=>validateFinanceMutation('save_entry',entry({reminder_days})));
  assert.equal(validateFinanceMutation('save_entry',entry({reminder_days:null})).payload.reminder_days,null);
  assert.equal(Object.hasOwn(validateFinanceMutation('save_entry',entry()).payload,'reminder_days'),false);
  const id=randomUUID(); assert.throws(()=>validateFinanceMutation('save_transfer',transfer(id,id.toUpperCase())));
  assert.throws(()=>validateFinanceMutation('save_goal',goal(id,{target_date:'2025-12-31'})));
  assert.throws(()=>validateFinanceMutation('save_goal',goal(id,{allocated_cents:-1})));
  assert.equal(Object.hasOwn(validateFinanceMutation('save_goal',goal(id,{user_id:secondOwner,achieved_milestones:[100]})).payload,'achieved_milestones'),false);
});

test('actual balances use start-of-day anchors, include same-day posted flows, and ignore forecasts', async () => {
  const a=account({kind:'savings',opening_date:'2026-01-10'}); await mutate('save_account',a);
  const historical=entry({kind:'income',account_id:a.id,amount_cents:5000,original_due_date:'2026-01-05',scheduled_date:'2026-01-05'});
  await mutate('save_entry',historical); await mutate('record_payment',{id:randomUUID(),entry_id:historical.id,amount_cents:5000,paid_on:'2026-01-05'});
  assert.equal(await actual(a.id,'2026-01-09'),0);
  const income=entry({kind:'income',account_id:a.id,amount_cents:10000}),bill=entry({account_id:a.id,amount_cents:3000});
  await mutate('save_entry',income); await mutate('save_entry',bill);
  await mutate('record_payment',{id:randomUUID(),entry_id:income.id,amount_cents:10000,paid_on:'2026-01-10'});
  await mutate('record_payment',{id:randomUUID(),entry_id:bill.id,amount_cents:3000,paid_on:'2026-01-10'});
  assert.equal(await actual(a.id,'2026-01-10'),107000);
  await mutate('save_balance_update',{account_id:a.id,date:'2026-01-10',balance_cents:200000});
  assert.equal(await actual(a.id,'2026-01-10'),207000,'Same-day correction wins the opening, then the day flows');
  await mutate('save_balance_update',{account_id:a.id,date:'2026-01-20',balance_cents:50000});
  const nextIncome=entry({kind:'income',account_id:a.id,amount_cents:2000}),nextBill=entry({account_id:a.id,amount_cents:500});
  await mutate('save_entry',nextIncome); await mutate('save_entry',nextBill);
  await mutate('record_payment',{id:randomUUID(),entry_id:nextIncome.id,amount_cents:2000,paid_on:'2026-01-20'});
  await mutate('record_payment',{id:randomUUID(),entry_id:nextBill.id,amount_cents:500,paid_on:'2026-01-20'});
  await mutate('entry_status',{id:nextBill.id,status:'cancelled',archived:true});
  await mutate('save_entry',entry({kind:'income',account_id:a.id,amount_cents:900000,scheduled_date:'2026-01-21'}));
  await mutate('save_spending',{id:randomUUID(),account_id:a.id,date:'2026-01-20',amount_cents:10000,title:'Scenario only'});
  assert.equal(await actual(a.id,'2026-01-20'),51500);
  await mutate('save_balance_update',{account_id:a.id,date:'2100-01-01',balance_cents:1000000000000});
  assert.equal(await actual(a.id,'2026-01-20'),51500,'Future anchors cannot change earlier actual funds');
  await mutate('save_balance_update',{account_id:a.id,date:'2026-01-01',balance_cents:40000});
  assert.equal(await actual(a.id,'2026-01-05'),45000,'An earlier explicit correction establishes earlier tracking');
  assert.equal(await actual(a.id,'2026-01-10'),207000);
});

test('dated balance upserts keep one row per owned account/date including the unassigned scope', async () => {
  const a=account(); await mutate('save_account',a);
  for (const account_id of [a.id,null]) {
    const first=await mutate('save_balance_update',{id:randomUUID(),account_id,date:'2026-02-01',balance_cents:-1234});
    const second=await mutate('save_balance_update',{id:randomUUID(),account_id,date:'2026-02-01',balance_cents:2500,notes:'Corrected'});
    assert.equal(first.id,second.id);
    const rows=(await snapshot()).balance_updates.filter(b=>b.account_id===account_id && b.date==='2026-02-01');
    assert.equal(rows.length,1); assert.equal(rows[0].balance_cents,2500);
    await denied(()=>db.query('insert into public.finance_balance_updates(user_id,account_id,date,balance_cents) values($1,$2,$3,10)',[owner,account_id,'2026-02-01']),'23505');
    await mutate('remove_balance_update',{id:first.id}); await mutate('remove_balance_update',{id:first.id});
  }
});

test('completed transfers conserve combined money and card payments reduce the negative card balance', async () => {
  const bank=account(),savings=account({kind:'savings',opening_balance_cents:20000}),card=account({kind:'credit_card',opening_balance_cents:-30000,credit_limit_cents:100000});
  for(const a of [bank,savings,card]) await mutate('save_account',a);
  const charge=entry({account_id:card.id,payment_method:'credit_card',amount_cents:2000}); await mutate('save_entry',charge);
  await mutate('record_payment',{id:randomUUID(),entry_id:charge.id,amount_cents:2000,paid_on:'2026-01-15'});
  assert.equal(await actual(card.id),-32000);
  const before=await snapshot(),payment=transfer(bank.id,card.id); await mutate('save_transfer',payment); await mutate('save_transfer',payment);
  assert.equal(await actual(bank.id),90000); assert.equal(await actual(card.id),-22000);
  assert.equal(await actual(bank.id)+await actual(savings.id)+await actual(card.id),88000);
  let s=await snapshot(); assert.equal(s.transfers.filter(t=>t.id===payment.id).length,1);
  assert.equal(s.payments.length,before.payments.length); assert.equal(s.entries.length,before.entries.length);
  const planned=transfer(bank.id,savings.id,{status:'planned',amount_cents:5000}); await mutate('save_transfer',planned);
  assert.equal(await actual(savings.id),20000);
  await mutate('transfer_status',{id:planned.id,status:'completed'}); assert.equal(await actual(savings.id),25000); assert.equal(await actual(bank.id),85000);
  await mutate('transfer_status',{id:planned.id,status:'cancelled'}); assert.equal(await actual(savings.id),20000); assert.equal(await actual(bank.id),90000);
  const future=transfer(bank.id,savings.id,{date:'2100-01-01',status:'planned'}); await mutate('save_transfer',future);
  await denied(()=>mutate('transfer_status',{id:future.id,status:'completed'}));
  assert.equal((await snapshot()).transfers.find(t=>t.id===future.id).status,'planned');
  await denied(()=>mutate('save_transfer',transfer(bank.id,savings.id,{date:'2100-01-01'})));
  await denied(()=>mutate('save_transfer',transfer(bank.id,bank.id),owner,false));
});

test('transfer tracking guards allow earlier replacement anchors and unrestricted amount corrections', async () => {
  const a=account({opening_date:'2026-01-10'}),b=account(); await mutate('save_account',a); await mutate('save_account',b);
  const t=transfer(a.id,b.id,{date:'2026-01-05'}); await denied(()=>mutate('save_transfer',t));
  const first=await mutate('save_balance_update',{account_id:a.id,date:'2026-01-01',balance_cents:100000}); await mutate('save_transfer',t);
  await denied(()=>mutate('remove_balance_update',{id:first.id}));
  await denied(()=>mutate('save_balance_update',{id:first.id,account_id:a.id,date:'2026-01-06',balance_cents:100000}));
  await denied(()=>mutate('save_balance_update',{id:first.id,account_id:null,date:'2026-01-01',balance_cents:100000}));
  const replacement=await mutate('save_balance_update',{account_id:a.id,date:'2025-12-31',balance_cents:100000});
  await mutate('remove_balance_update',{id:first.id});
  await mutate('save_balance_update',{id:replacement.id,account_id:a.id,date:'2025-12-31',balance_cents:-500});
  assert.equal(await actual(a.id,'2026-01-05'),-10500,'Amount corrections may record a negative real balance');
  await denied(()=>mutate('remove_balance_update',{id:replacement.id}));
  await mutate('transfer_status',{id:t.id,status:'cancelled'}); await mutate('remove_balance_update',{id:replacement.id});
  await denied(()=>mutate('transfer_status',{id:t.id,status:'completed'}));
  const c=account(); await mutate('save_account',c); await mutate('save_transfer',transfer(c.id,b.id,{date:'2026-01-05'}));
  await denied(()=>mutate('save_account',{...c,opening_date:'2026-01-06'}));
  await mutate('save_account',{...c,opening_balance_cents:-100});
});

test('payment account and method snapshots survive entry edits, partial payments, retries and reversals', async () => {
  const a=account(),b=account(),c=account({kind:'cash',last_four:null}); for(const x of [a,b,c]) await mutate('save_account',x);
  const e=entry({account_id:a.id,payment_method:'autopay',reminder_days:5}); await mutate('save_entry',e);
  const first={id:randomUUID(),entry_id:e.id,amount_cents:4000,paid_on:'2026-01-15'}; await mutate('record_payment',first);
  await mutate('save_entry',{...e,account_id:b.id,payment_method:'bank_transfer',reminder_days:null});
  await mutate('record_payment',first);
  await denied(()=>mutate('record_payment',{...first,account_id:b.id,payment_method:'bank_transfer'}));
  const second={id:randomUUID(),entry_id:e.id,amount_cents:2000,paid_on:'2026-01-16',account_id:c.id,payment_method:'cash'}; await mutate('record_payment',second);
  await mutate('record_payment',{id:randomUUID(),entry_id:e.id,amount_cents:4000,paid_on:'2026-01-17'});
  await mutate('save_entry',{...e,account_id:null,payment_method:'manual'});
  assert.equal(await actual(a.id),96000); assert.equal(await actual(b.id),96000); assert.equal(await actual(c.id),98000);
  const s=await snapshot(); assert.equal(s.payments.find(p=>p.id===first.id).account_id,a.id); assert.equal(s.payments.find(p=>p.id===first.id).payment_method,'autopay');
  await mutate('remove_payment',{id:second.id}); await mutate('record_payment',second); assert.equal(await actual(c.id),100000);
  await denied(()=>mutate('record_payment',{id:randomUUID(),entry_id:e.id,amount_cents:1,paid_on:'2026-01-18',payment_method:'direct_deposit'}));
  const income=entry({kind:'income',account_id:a.id,payment_method:'direct_deposit',amount_cents:5000}); await mutate('save_entry',income);
  await mutate('record_payment',{id:randomUUID(),entry_id:income.id,amount_cents:5000,paid_on:'2026-01-20'});
  assert.equal(await actual(a.id),101000);
});

test('series inherit payment settings and plan changes update active unpaid forecasts without moving posted history', async () => {
  const a=account(),b=account(); await mutate('save_account',a); await mutate('save_account',b);
  const recurring=entry({kind:'income',account_id:a.id,payment_method:'direct_deposit',reminder_days:2,frequency:'custom',custom_mode:'month_days',custom_month_days:[15,31],end_date:'2026-03-31'});
  await mutate('save_entry',recurring); let s=await snapshot(); const series=s.entries.find(e=>e.id===recurring.id).series_id;
  assert.ok(s.entries.filter(e=>e.series_id===series).every(e=>e.account_id===a.id && e.payment_method==='direct_deposit' && e.reminder_days===2));
  await mutate('save_entry',{...recurring,frequency:'once',account_id:b.id,payment_method:'cash',reminder_days:0});
  s=await snapshot(); assert.equal(s.series.find(x=>x.id===series).account_id,a.id);
  assert.ok(s.entries.filter(e=>e.series_id===series && e.id!==recurring.id).every(e=>e.account_id===a.id));
  const p=plan({account_id:a.id,payment_method:'autopay',reminder_days:3}); await mutate('save_plan',p);
  const children=(await snapshot()).entries.filter(e=>e.plan_id===p.id);
  const paid={id:randomUUID(),entry_id:children[0].id,amount_cents:3000,paid_on:'2026-01-31'}; await mutate('record_payment',paid);
  const partial={id:randomUUID(),entry_id:children[1].id,amount_cents:1000,paid_on:'2026-02-28'}; await mutate('record_payment',partial);
  await mutate('entry_status',{id:children[2].id,status:'cancelled'});
  await mutate('save_entry',{...children[3],account_id:b.id,payment_method:'cash',reminder_days:7});
  await mutate('entry_status',{id:children[3].id,status:'active',archived:true});
  await mutate('save_plan',{...p,reminder_days:8});
  s=await snapshot(); let last=s.entries.find(e=>e.id===children[3].id);
  assert.equal(last.account_id,b.id); assert.equal(last.payment_method,'cash'); assert.equal(last.reminder_days,8);
  assert.equal(s.entries.find(e=>e.id===children[0].id).reminder_days,3);
  await mutate('save_plan',{...p,account_id:b.id,payment_method:'bank_transfer',reminder_days:8}); s=await snapshot();
  assert.equal(s.entries.find(e=>e.id===children[0].id).account_id,a.id);
  assert.equal(s.entries.find(e=>e.id===children[2].id).account_id,a.id);
  assert.equal(s.entries.find(e=>e.id===children[1].id).account_id,b.id);
  last=s.entries.find(e=>e.id===children[3].id); assert.equal(last.account_id,b.id); assert.equal(last.payment_method,'bank_transfer');
  for(const payment of [paid,partial]) { const recorded=s.payments.find(x=>x.id===payment.id); assert.equal(recorded.account_id,a.id); assert.equal(recorded.payment_method,'autopay'); }
  assert.equal(await actual(a.id),96000); assert.equal(await actual(b.id),100000);
});

test('spending scopes and reminder snoozes remain owned and separate from posted cash', async () => {
  const a=account(),b=account(); await mutate('save_account',a); await mutate('save_account',b);
  const items=[a.id,b.id,null].map(account_id=>({id:randomUUID(),account_id,date:'2026-04-15',amount_cents:20000,title:'Scenario'}));
  for(const item of items) await mutate('save_spending',item);
  const {account_id:omitted,...legacyEdit}=items[0]; await mutate('save_spending',{...legacyEdit,amount_cents:10000});
  assert.equal((await snapshot()).spending.find(x=>x.id===items[0].id).account_id,a.id);
  await mutate('clear_spending',{month:'2026-04',account_id:a.id}); let s=await snapshot();
  assert.ok(!s.spending.some(x=>x.id===items[0].id)); assert.ok(s.spending.some(x=>x.id===items[1].id)); assert.ok(s.spending.some(x=>x.id===items[2].id));
  await mutate('clear_spending',{month:'2026-04',account_id:null}); s=await snapshot(); assert.ok(!s.spending.some(x=>x.id===items[2].id));
  assert.equal(await actual(b.id),100000); await mutate('clear_spending',{month:'2026-04'});
  const e=entry({account_id:a.id,reminder_days:0}); await mutate('save_entry',e);
  await mutate('snooze_reminder',{id:e.id,until:'2026-02-10'});
  assert.equal((await snapshot()).entries.find(x=>x.id===e.id).reminder_snoozed_until,'2026-02-10');
  await denied(()=>mutate('snooze_reminder',{id:e.id,until:null},secondOwner),'P0002');
  await mutate('snooze_reminder',{id:e.id,until:null}); assert.equal((await snapshot()).entries.find(x=>x.id===e.id).reminder_snoozed_until,null);
});

test('savings milestones are awarded once and persist through allocation reductions and target changes', async () => {
  const a=account({kind:'savings',opening_balance_cents:200000}); await mutate('save_account',a);
  const g=goal(a.id,{allocated_cents:25000});
  assert.deepEqual((await mutate('save_goal',g)).milestones,[25]);
  assert.deepEqual((await mutate('save_goal',g)).milestones,[]);
  assert.equal((await one('select count(*)::int n from public.finance_goal_history where goal_id=$1',[g.id])).n,1);
  assert.deepEqual((await mutate('save_goal',{...g,allocated_cents:50000,change_note:'Added to emergency savings'})).milestones,[50]);
  assert.deepEqual((await mutate('save_goal',{...g,allocated_cents:10000})).milestones,[]);
  assert.deepEqual((await mutate('save_goal',{...g,target_cents:10000,allocated_cents:10000})).milestones,[75,100]);
  assert.deepEqual((await mutate('save_goal',{...g,target_cents:200000,allocated_cents:200000})).milestones,[]);
  let s=await snapshot(); assert.deepEqual(s.goals.find(x=>x.id===g.id).achieved_milestones,[25,50,75,100]);
  assert.equal(await actual(a.id),200000,'Allocations reserve existing funds without spending them');
  await mutate('goal_status',{id:g.id,archived:true});
  assert.deepEqual((await mutate('goal_status',{id:g.id,archived:false})).milestones,undefined);
  s=await snapshot(); assert.deepEqual(s.goals.find(x=>x.id===g.id).achieved_milestones,[25,50,75,100]);
  assert.ok(s.goal_history.some(h=>h.goal_id===g.id && h.previous_allocated_cents===null && h.allocated_cents===25000));
  assert.ok(s.goal_history.some(h=>h.goal_id===g.id && h.note==='Added to emergency savings'));
});

test('goals cannot reserve the same savings twice and failed changes leave allocation/history untouched', async () => {
  const a=account({kind:'savings'}); await mutate('save_account',a);
  const first=goal(a.id,{allocated_cents:60000}),second=goal(a.id,{allocated_cents:40001});
  await mutate('save_goal',first); await denied(()=>mutate('save_goal',second));
  assert.equal((await one('select count(*)::int n from public.finance_savings_goals where id=$1',[second.id])).n,0);
  assert.equal((await one('select count(*)::int n from public.finance_goal_history where goal_id=$1',[second.id])).n,0);
  await mutate('save_goal',{...second,allocated_cents:40000});
  const before=await snapshot(); await denied(()=>mutate('save_goal',{...first,allocated_cents:60001}));
  const after=await snapshot();
  assert.deepEqual(after.goals.filter(g=>g.account_id===a.id),before.goals.filter(g=>g.account_id===a.id));
  assert.deepEqual(after.goal_history.filter(h=>h.goal_id===first.id),before.goal_history.filter(h=>h.goal_id===first.id));
  const raw=goal(a.id,{target_cents:0}); await denied(()=>mutate('save_goal',raw,owner,false),'23514');
  assert.equal((await one('select count(*)::int n from public.finance_goal_history where goal_id=$1',[raw.id])).n,0);
  const concurrent=account({kind:'savings',opening_balance_cents:70000}); await mutate('save_account',concurrent);
  const attempts=await Promise.allSettled([mutate('save_goal',goal(concurrent.id,{allocated_cents:40000})),mutate('save_goal',goal(concurrent.id,{allocated_cents:40000}))]);
  assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1); assert.equal(attempts.filter(x=>x.status==='rejected').length,1);
  assert.equal(Number((await one('select sum(allocated_cents) n from public.finance_savings_goals where account_id=$1',[concurrent.id])).n),40000);
});

test('real balance corrections and lower or unchanged allocations remain possible after savings fall', async () => {
  const a=account({kind:'savings'}); await mutate('save_account',a);
  const first=goal(a.id,{allocated_cents:60000}),second=goal(a.id,{allocated_cents:40000}); await mutate('save_goal',first); await mutate('save_goal',second);
  const today=(await snapshot()).today;
  await mutate('save_balance_update',{account_id:a.id,date:today,balance_cents:10000});
  await mutate('save_goal',{...first,notes:'Cash balance corrected without hiding the old earmark'});
  await mutate('save_goal',{...first,allocated_cents:50000});
  await denied(()=>mutate('save_goal',{...first,allocated_cents:50001}));
  await mutate('save_goal',goal(a.id,{allocated_cents:0,title:'Future goal'}));
  await denied(()=>mutate('save_goal',goal(a.id,{allocated_cents:1})));
  await mutate('goal_status',{id:first.id,archived:false});
  await mutate('goal_status',{id:second.id,archived:true}); await denied(()=>mutate('goal_status',{id:second.id,archived:false}));
  await mutate('save_goal',{...second,allocated_cents:0}); await mutate('goal_status',{id:second.id,archived:false});
  await mutate('goal_status',{id:first.id,archived:true});
  await mutate('save_balance_update',{account_id:a.id,date:'2100-01-01',balance_cents:1000000000000});
  await denied(()=>mutate('save_goal',goal(a.id,{allocated_cents:10001})));
  await mutate('save_balance_update',{account_id:a.id,date:today,balance_cents:-500});
  await mutate('save_goal',goal(a.id,{allocated_cents:0,title:'Empty goal despite a deficit'}));
  await denied(()=>mutate('save_goal',goal(a.id,{allocated_cents:1})));
  assert.equal(await actual(a.id,today),-500);
});

test('only completed transfers and received income fund savings goals, with no duplicate cash movement', async () => {
  const bank=account(),savings=account({kind:'savings',opening_balance_cents:0}); await mutate('save_account',bank); await mutate('save_account',savings);
  const t=transfer(bank.id,savings.id,{amount_cents:20000,status:'planned'}); await mutate('save_transfer',t);
  const g=goal(savings.id,{target_cents:80000,allocated_cents:20000}); await denied(()=>mutate('save_goal',g));
  const forecast=entry({kind:'income',account_id:savings.id,payment_method:'direct_deposit',amount_cents:100000}); await mutate('save_entry',forecast);
  await denied(()=>mutate('save_goal',g));
  await mutate('transfer_status',{id:t.id,status:'completed'}); assert.deepEqual((await mutate('save_goal',g)).milestones,[25]);
  assert.equal(await actual(bank.id)+await actual(savings.id),100000);
  await mutate('transfer_status',{id:t.id,status:'cancelled'}); assert.equal(await actual(savings.id),0);
  await denied(()=>mutate('save_goal',{...g,allocated_cents:20001}));
  await mutate('save_goal',{...g,allocated_cents:10000});
  await mutate('record_payment',{id:randomUUID(),entry_id:forecast.id,amount_cents:15000,paid_on:'2026-01-15'});
  await mutate('save_goal',goal(savings.id,{allocated_cents:5000}));
  await denied(()=>mutate('save_goal',goal(savings.id,{allocated_cents:1})));
  const future=account({kind:'savings',opening_date:'2100-01-01',opening_balance_cents:100000}); await mutate('save_account',future);
  await mutate('save_goal',goal(future.id,{start_date:'2100-01-01',allocated_cents:0}));
  await denied(()=>mutate('save_goal',goal(future.id,{allocated_cents:1})));
});

test('account archiving preserves existing relationships and active goals protect the savings account kind', async () => {
  const savings=account({kind:'savings'}),other=account({kind:'savings'}),checking=account(); for(const a of [savings,other,checking]) await mutate('save_account',a);
  await denied(()=>mutate('save_goal',goal(checking.id)));
  const g=goal(savings.id,{allocated_cents:50000}); await mutate('save_goal',g);
  await denied(()=>mutate('save_account',{...savings,kind:'checking'}));
  const e=entry({account_id:savings.id,payment_method:'bank_transfer'}); await mutate('save_entry',e);
  await mutate('account_status',{id:savings.id,archived:true});
  await mutate('save_goal',{...g,allocated_cents:40000,notes:'Preserve archived original account'});
  await mutate('save_entry',e); await mutate('record_payment',{id:randomUUID(),entry_id:e.id,amount_cents:1000,paid_on:'2026-01-15'});
  await denied(()=>mutate('save_entry',entry({account_id:savings.id})));
  await denied(()=>mutate('save_goal',goal(savings.id)));
  await mutate('goal_status',{id:g.id,archived:true}); await mutate('save_account',{...savings,kind:'checking'});
  await denied(()=>mutate('goal_status',{id:g.id,archived:false}));
  await mutate('save_goal',{...g,account_id:other.id,allocated_cents:40000}); await mutate('goal_status',{id:g.id,archived:false});
  const s=await snapshot(); assert.ok(s.accounts.find(x=>x.id===savings.id).archived_at); assert.equal(s.goals.find(x=>x.id===g.id).account_id,other.id);
});

test('new account, balance, transfer and goal operations enforce ownership at actions and foreign keys', async () => {
  const owned=account({kind:'savings'}),foreign=account({kind:'savings'}); await mutate('save_account',owned); await mutate('save_account',foreign,secondOwner);
  await denied(()=>mutate('save_account',{...foreign,name:'Hijacked'}),'P0002');
  await denied(()=>mutate('account_status',{id:foreign.id,archived:true}),'P0002');
  await denied(()=>actual(foreign.id),'P0002');
  await denied(()=>mutate('save_balance_update',{account_id:foreign.id,date:'2026-01-01',balance_cents:1}),'P0002');
  await denied(()=>mutate('save_transfer',transfer(owned.id,foreign.id)),'P0002');
  await denied(()=>mutate('save_goal',goal(foreign.id)),'P0002');
  await denied(()=>mutate('save_spending',{id:randomUUID(),account_id:foreign.id,date:'2026-01-01',amount_cents:1,title:'Wrong account'}),'P0002');
  await denied(()=>mutate('clear_spending',{month:'2026-01',account_id:foreign.id}),'P0002');
  const foreignGoal=goal(foreign.id,{allocated_cents:1000}); await mutate('save_goal',foreignGoal,secondOwner);
  await denied(()=>mutate('save_goal',{...foreignGoal,account_id:owned.id}),'P0002'); await denied(()=>mutate('goal_status',{id:foreignGoal.id,archived:true}),'P0002');
  const foreignUpdate=await mutate('save_balance_update',{account_id:foreign.id,date:'2026-01-20',balance_cents:2000},secondOwner);
  await denied(()=>mutate('save_balance_update',{id:foreignUpdate.id,account_id:owned.id,date:'2026-01-20',balance_cents:1}),'P0002');
  await mutate('remove_balance_update',{id:foreignUpdate.id}); assert.ok((await snapshot(secondOwner)).balance_updates.some(x=>x.id===foreignUpdate.id));
  const e=entry({account_id:owned.id}); await mutate('save_entry',e);
  await denied(()=>mutate('record_payment',{id:randomUUID(),entry_id:e.id,amount_cents:1,paid_on:'2026-01-15',account_id:foreign.id}),'P0002');
  await denied(()=>db.query('update public.finance_entries set account_id=$1 where id=$2',[foreign.id,e.id]),'23503');
  await denied(()=>db.query('insert into public.finance_goal_history(user_id,goal_id,allocated_cents) values($1,$2,0)',[owner,foreignGoal.id]),'23503');
  const s=await snapshot(); assert.ok(!s.accounts.some(x=>x.id===foreign.id)); assert.ok(!s.goals.some(x=>x.id===foreignGoal.id)); assert.ok(!s.balance_updates.some(x=>x.id===foreignUpdate.id));
});

test('collection reversal restores cash to its recorded account even after the bill account changes', async () => {
  const first=account(),second=account(); await mutate('save_account',first); await mutate('save_account',second);
  const e=entry({account_id:first.id,payment_method:'debit_card'}); await mutate('save_entry',e);
  const payment={id:randomUUID(),entry_id:e.id,amount_cents:4000,paid_on:'2026-01-15'}; await mutate('record_payment',payment);
  await mutate('save_entry',{...e,account_id:second.id,payment_method:'bank_transfer'});
  const d=await mutate('transfer_collections',{entry_id:e.id,collector:'Test collections'});
  assert.equal(await actual(first.id),96000); assert.equal(await actual(second.id),100000);
  await mutate('remove_payment',{id:payment.id});
  assert.equal(await actual(first.id),100000); assert.equal(await actual(second.id),100000);
  assert.equal((await snapshot()).debts.find(x=>x.id===d.id).current_balance_cents,10000);
});

test('account migration is repeatable with posted cash and savings history, with least-privilege grants', async () => {
  const before=await snapshot(); await db.exec(accountsMigration); await db.exec(householdMigration); await db.exec(tagsMigration); const after=await snapshot(); assert.deepEqual(after,before);
  for(const table of ['finance_accounts','finance_transfers','finance_savings_goals','finance_goal_history']) {
    assert.equal((await one("select has_table_privilege('service_role',$1,'DELETE,TRUNCATE,REFERENCES,TRIGGER') granted",[`public.${table}`])).granted,false,table);
  }
  assert.equal((await one("select has_table_privilege('service_role','public.finance_goal_history','UPDATE') granted")).granted,false);
  assert.equal((await one("select has_table_privilege('service_role','public.finance_balance_updates','DELETE') granted")).granted,true);
  assert.equal((await one("select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname like 'finance_%' and (prosecdef or has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE'))")).n,0);
});

test('household migration adds empty labels to legacy debts without changing money, timestamps or history', () => {
  assert.ok(migratedHouseholdSnapshot.debts.every(d=>Array.isArray(d.responsible_people) && d.responsible_people.length===0));
  const withoutNewField={...migratedHouseholdSnapshot,debts:migratedHouseholdSnapshot.debts.map(({responsible_people,...d})=>d)};
  assert.deepEqual(withoutNewField,legacyHouseholdSnapshot);
  assert.equal(migratedHouseholdSnapshot.debts.find(d=>d.id===legacyDebt.id).current_balance_cents,10000);
});

test('household API input normalizes names, preserves omission and rejects malformed names', () => {
  const people=['  Janna\u00a0  Smith  ','JANNA SMITH','Alex','aLeX','Élodie  D’Arcy'];
  const expected=['Janna Smith','Alex','Élodie D’Arcy'];
  assert.deepEqual(validateFinanceMutation('save_debt',debt({responsible_people:people})).payload.responsible_people,expected);
  assert.deepEqual(validateFinanceMutation('transfer_collections',{entry_id:randomUUID(),responsible_people:people}).payload.responsible_people,expected);
  assert.equal(Object.hasOwn(validateFinanceMutation('save_debt',debt()).payload,'responsible_people'),false);
  assert.equal(Object.hasOwn(validateFinanceMutation('transfer_collections',{entry_id:randomUUID()}).payload,'responsible_people'),false);
  assert.deepEqual(validateFinanceMutation('save_debt',debt({responsible_people:[]})).payload.responsible_people,[]);
  const twenty=Array.from({length:20},(_,i)=>`Person ${i+1}`);
  assert.deepEqual(validateFinanceMutation('save_debt',debt({responsible_people:[...twenty,' PERSON 1 ']})).payload.responsible_people,twenty);
  const codePoints='\u{10428}'.repeat(100);
  assert.deepEqual(validateFinanceMutation('save_debt',debt({responsible_people:[codePoints]})).payload.responsible_people,[codePoints]);
  for(const invalid of [null,'Alice',{},[null],[1],[{}],[['Alice']],[''],['   '],['Alice\nBob'],['\tAlice'],['Alice\u007f'],['Alice\u0085'],['Alice\u2028Bob'],['Alice\u2029Bob'],['A'.repeat(101)],[codePoints+'A'],[...twenty,'Person 21']]) {
    assert.throws(()=>validateFinanceMutation('save_debt',debt({responsible_people:invalid})),{name:'FinanceInputError'});
    assert.throws(()=>validateFinanceMutation('transfer_collections',{entry_id:randomUUID(),responsible_people:invalid}),{name:'FinanceInputError'});
  }
});

test('SQL independently normalizes household names and rejects noncanonical direct writes', async () => {
  const spaces=' \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u202f\u205f\u3000\ufeff';
  const names=[`${spaces}Janna${spaces}Smith${spaces}`,'janna smith','Élodie',"O'Neil"]; const expected=['Janna Smith','Élodie',"O'Neil"];
  const d=debt({responsible_people:names}); await mutate('save_debt',d,owner,false);
  assert.deepEqual((await snapshot()).debts.find(x=>x.id===d.id).responsible_people,expected);
  for(const [input,normalized] of [[['İpek','Ipek'],['İpek','Ipek']],[['ΟΣ','ος'],['ΟΣ']]]) {
    const clean=validateFinanceMutation('save_debt',debt({responsible_people:input})).payload.responsible_people;
    const sql=(await one('select public.finance_responsible_people($1::jsonb) names',[JSON.stringify(input)])).names;
    assert.deepEqual(clean,normalized); assert.deepEqual(sql,normalized);
  }
  const twenty=Array.from({length:20},(_,i)=>`Person ${i+1}`), codePoints='\u{10428}'.repeat(100);
  assert.deepEqual((await one('select public.finance_responsible_people($1::jsonb) names',[JSON.stringify([...twenty,' PERSON 1 '])])).names,twenty);
  assert.deepEqual((await one('select public.finance_responsible_people($1::jsonb) names',[JSON.stringify([codePoints])])).names,[codePoints]);
  const before=(await snapshot()).debts.find(x=>x.id===d.id);
  for(const invalid of [null,'Alice',{},[null],[false],[{}],[['Alice']],[''],['Alice\nBob'],['\tAlice'],['Alice\u007f'],['Alice\u0085'],['Alice\u2028Bob'],['Alice\u2029Bob'],['A'.repeat(101)],Array.from({length:21},(_,i)=>`Person ${i}`)]) {
    await denied(()=>mutate('save_debt',{...d,responsible_people:invalid},owner,false));
  }
  assert.deepEqual((await snapshot()).debts.find(x=>x.id===d.id),before,'Rejected assignments do not change even the timestamp');
  await denied(()=>db.query("update public.finance_debts set responsible_people=array[' Alice '] where id=$1",[d.id]),'23514');
  await denied(()=>db.query("update public.finance_debts set responsible_people=array['Alice','alice'] where id=$1",[d.id]),'23514');
  await denied(()=>db.query('update public.finance_debts set responsible_people=null where id=$1',[d.id]),'23502');
  await denied(()=>db.query("update public.finance_debts set responsible_people=array[['Alice'],['Bob']] where id=$1",[d.id]));
  const injection="Robert'); drop table finance_debts;--";
  await mutate('save_debt',{...d,responsible_people:[injection]},owner,false);
  assert.deepEqual((await snapshot()).debts.find(x=>x.id===d.id).responsible_people,[injection]);
  assert.equal((await one("select to_regclass('public.finance_debts') is not null present")).present,true);
});

test('one shared debt keeps one balance and records assignment changes, preserving old forms and allowing clear', async () => {
  const d=debt({responsible_people:['Alice','Bob']}); await mutate('save_debt',d);
  let s=await snapshot(); let saved=s.debts.find(x=>x.id===d.id);
  assert.deepEqual(saved.responsible_people,['Alice','Bob']);
  assert.equal(s.debts.filter(x=>x.id===d.id).length,1); assert.equal(saved.current_balance_cents,10000);
  let h=s.debt_history.filter(x=>x.debt_id===d.id);
  assert.equal(h.length,1); assert.deepEqual(h[0].details.previous_responsible_people,[]); assert.deepEqual(h[0].details.responsible_people,['Alice','Bob']);
  const {responsible_people,...oldForm}=d;
  await mutate('save_debt',{...oldForm,notes:'Collector letter received'});
  s=await snapshot(); saved=s.debts.find(x=>x.id===d.id);
  assert.deepEqual(saved.responsible_people,['Alice','Bob']);
  h=s.debt_history.filter(x=>x.debt_id===d.id); assert.equal(h.length,2);
  assert.deepEqual(h[0].details.previous_responsible_people,['Alice','Bob']); assert.deepEqual(h[0].details.responsible_people,['Alice','Bob']);
  await mutate('save_debt',{...saved,responsible_people:[]});
  s=await snapshot(); saved=s.debts.find(x=>x.id===d.id); h=s.debt_history.filter(x=>x.debt_id===d.id);
  assert.deepEqual(saved.responsible_people,[]); assert.equal(saved.current_balance_cents,10000); assert.equal(h.length,3);
  assert.deepEqual(h[0].details.previous_responsible_people,['Alice','Bob']); assert.deepEqual(h[0].details.responsible_people,[]);
  await mutate('save_debt',saved);
  assert.equal((await snapshot()).debt_history.filter(x=>x.debt_id===d.id).length,3,'An unchanged save adds no assignment history');
});

test('bill collections transfer stores household names once and retries preserve subsequent edits', async () => {
  const e=entry(); await mutate('save_entry',e);
  const payment={id:randomUUID(),entry_id:e.id,amount_cents:2500,paid_on:'2026-01-15'}; await mutate('record_payment',payment);
  const payload={id:randomUUID(),entry_id:e.id,collector:'Original collector',responsible_people:[' Pat  Doe ','Alex','pat doe']};
  const result=await mutate('transfer_collections',payload);
  let s=await snapshot(); let saved=s.debts.find(x=>x.id===result.id);
  assert.equal(saved.current_balance_cents,7500); assert.deepEqual(saved.responsible_people,['Pat Doe','Alex']);
  const h=s.debt_history.find(x=>x.debt_id===result.id);
  assert.deepEqual(h.details.previous_responsible_people,[]); assert.deepEqual(h.details.responsible_people,['Pat Doe','Alex']); assert.equal(h.details.source_entry_id,e.id);
  const replay=await mutate('transfer_collections',{...payload,id:randomUUID(),collector:'Different collector',responsible_people:['Changed on retry']});
  assert.deepEqual(replay,{id:result.id,replayed:true});
  assert.deepEqual((await snapshot()).debts.find(x=>x.id===result.id),saved);
  await mutate('save_debt',{...saved,responsible_people:['Updated assignment']});
  const beforeRetry=await snapshot(); await mutate('transfer_collections',payload); await mutate('transfer_collections',{entry_id:e.id});
  assert.deepEqual(await snapshot(),beforeRetry);
  await mutate('remove_payment',{id:payment.id}); s=await snapshot(); saved=s.debts.find(x=>x.id===result.id);
  assert.equal(saved.current_balance_cents,10000); assert.deepEqual(saved.responsible_people,['Updated assignment']);
  assert.equal(s.debts.filter(x=>x.source_entry_id===e.id).length,1);
});

test('payment plan collections transfer assigns one shared debt without duplicating installments or balances', async () => {
  const p=plan(); await mutate('save_plan',p);
  const children=(await snapshot()).entries.filter(e=>e.plan_id===p.id);
  await mutate('record_payment',{id:randomUUID(),entry_id:children[0].id,amount_cents:1000,paid_on:'2026-01-15'});
  const payload={id:randomUUID(),plan_id:p.id,responsible_people:['Morgan','Jordan']};
  const result=await mutate('transfer_collections',payload);
  const s=await snapshot(); const saved=s.debts.find(d=>d.id===result.id);
  assert.equal(saved.current_balance_cents,8001); assert.equal(saved.original_balance_cents,8001);
  assert.deepEqual(saved.responsible_people,['Morgan','Jordan']);
  assert.equal(s.debts.filter(d=>d.source_plan_id===p.id).length,1);
  assert.equal(s.plans.find(x=>x.id===p.id).status,'collections');
  assert.equal(s.entries.filter(e=>e.plan_id===p.id).length,children.length);
  assert.ok(s.entries.filter(e=>e.plan_id===p.id).every(e=>e.status==='collections'));
  assert.deepEqual(s.debt_history.find(h=>h.debt_id===result.id).details.responsible_people,['Morgan','Jordan']);
  assert.deepEqual(await mutate('transfer_collections',{...payload,responsible_people:[]}),{id:result.id,replayed:true});
  assert.deepEqual(await snapshot(),s);
});

test('invalid household assignments and conflicting collection IDs roll back the entire source transfer', async () => {
  const e=entry(), p=plan(); await mutate('save_entry',e); await mutate('save_plan',p);
  const before=await snapshot();
  await denied(()=>mutate('transfer_collections',{entry_id:e.id,responsible_people:['Name\nInvalid']},owner,false));
  await denied(()=>mutate('transfer_collections',{plan_id:p.id,responsible_people:[null]},owner,false));
  assert.deepEqual(await snapshot(),before);
  const occupied=debt({responsible_people:['Original person']}); await mutate('save_debt',occupied);
  const beforeConflict=await snapshot();
  await denied(()=>mutate('transfer_collections',{id:occupied.id,entry_id:e.id,responsible_people:['Different person']}),'23505');
  assert.deepEqual(await snapshot(),beforeConflict);
});

test('household labels never grant access or let another approved owner alter debts or source transfers', async () => {
  const d=debt({responsible_people:['Other owner','Family member']}); await mutate('save_debt',d);
  const e=entry(),p=plan(); await mutate('save_entry',e); await mutate('save_plan',p);
  const before=await snapshot();
  await denied(()=>mutate('save_debt',{...d,responsible_people:['Hijacked']},secondOwner),'23505');
  await denied(()=>mutate('transfer_collections',{entry_id:e.id,responsible_people:['Other owner']},secondOwner),'P0002');
  await denied(()=>mutate('transfer_collections',{plan_id:p.id,responsible_people:['Other owner']},secondOwner),'P0002');
  assert.deepEqual(await snapshot(),before);
  const theirs=await snapshot(secondOwner);
  assert.equal(theirs.debts.some(x=>x.id===d.id),false); assert.equal(theirs.debt_history.some(x=>x.debt_id===d.id),false);
  for(const actor of [support,banned,unverified]) await denied(()=>mutate('save_debt',debt({responsible_people:['Family member']}),actor),'42501');
  for(const role of ['anon','authenticated']) {
    assert.equal((await one("select has_function_privilege($1,'public.finance_responsible_people(jsonb)','EXECUTE') granted",[role])).granted,false);
    assert.equal((await one("select has_table_privilege($1,'public.finance_debts','SELECT,INSERT,UPDATE,DELETE') granted",[role])).granted,false);
  }
});

test('household migration is repeatable with assignments, shared collections and private grants intact', async () => {
  const before=await snapshot(); await db.exec(householdMigration); await db.exec(tagsMigration); assert.deepEqual(await snapshot(),before);
  assert.equal((await one("select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname like 'finance_%'")).n,18);
  assert.equal((await one("select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname like 'finance_%' and (prosecdef or has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE'))")).n,0);
  assert.equal((await one("select has_table_privilege('service_role','public.finance_access','INSERT,UPDATE,DELETE') granted")).granted,false);
});

test('tag migration preserves existing finances and timestamps while adding only empty metadata', () => {
  const {tags,...withoutNewFields}=migratedTagsSnapshot;
  assert.deepEqual(tags,[]);
  for(const collection of ['entries','series','plans']) {
    assert.ok(withoutNewFields[collection].length>0);
    withoutNewFields[collection]=withoutNewFields[collection].map(({tag_ids,...row})=>{assert.deepEqual(tag_ids,[]);return row;});
  }
  assert.deepEqual(withoutNewFields,legacyTagsSnapshot);
});

test('tag input validates normalized names and canonical unique UUID sets without replacing omitted tags', () => {
  const ids=Array.from({length:20},()=>randomUUID()), expected=[...ids].sort();
  assert.equal(validateFinanceMutation('save_tag',tag({name:'  Family\u00a0  budget  '})).payload.name,'Family budget');
  assert.equal(validateFinanceMutation('save_tag',tag({name:'\u{10428}'.repeat(60)})).payload.name,'\u{10428}'.repeat(60));
  assert.deepEqual(validateFinanceMutation('save_entry',entry({tag_ids:[...ids,ids[0].toUpperCase()]})).payload.tag_ids,expected);
  assert.deepEqual(validateFinanceMutation('save_plan',plan({tag_ids:[...ids].reverse()})).payload.tag_ids,expected);
  assert.equal(Object.hasOwn(validateFinanceMutation('save_entry',entry()).payload,'tag_ids'),false);
  assert.equal(Object.hasOwn(validateFinanceMutation('save_plan',plan()).payload,'tag_ids'),false);
  assert.deepEqual(validateFinanceMutation('save_entry',entry({tag_ids:[]})).payload.tag_ids,[]);
  for(const name of [null,{},2,'','   ','A\nB','A\tB','A\u0085B','A\u2028B','A\u2029B','A'.repeat(61),'\u{10428}'.repeat(61)]) assert.throws(()=>validateFinanceMutation('save_tag',tag({name})),{name:'FinanceInputError'});
  for(const tag_ids of [null,{},'tag',[null],[1],[{}],['not-an-id'],[...ids,randomUUID()]]) {
    assert.throws(()=>validateFinanceMutation('save_entry',entry({tag_ids})),{name:'FinanceInputError'});
    assert.throws(()=>validateFinanceMutation('save_plan',plan({tag_ids})),{name:'FinanceInputError'});
  }
  assert.throws(()=>validateFinanceMutation('archive_tag',{id:ids[0],archived:'yes'}));
  const cleaned=validateFinanceMutation('save_tag',tag({user_id:secondOwner,archived_at:'2026-01-01'})).payload;
  assert.equal(cleaned.user_id,undefined); assert.equal(cleaned.archived_at,undefined);
});

test('tag names are Unicode-normalized, case-insensitively unique per owner, renameable and restorable', async () => {
  const suffix=randomUUID(), t=tag({name:`  Family\u00a0   budget ${suffix}  `});
  await mutate('save_tag',t,owner,false);
  let saved=(await snapshot()).tags.find(x=>x.id===t.id);
  assert.equal(saved.name,`Family budget ${suffix}`);
  await mutate('save_tag',{...t,name:saved.name}); assert.deepEqual((await snapshot()).tags.find(x=>x.id===t.id),saved,'Retrying an unchanged tag preserves timestamps');
  await assert.rejects(()=>mutate('save_tag',tag({name:saved.name.toUpperCase()})),/already exists/);
  await mutate('save_tag',tag({name:saved.name}),secondOwner);
  await mutate('archive_tag',{id:t.id,archived:true});
  assert.ok((await snapshot()).tags.find(x=>x.id===t.id).archived_at);
  await assert.rejects(()=>mutate('save_tag',tag({name:saved.name})),/restore it if archived/);
  await mutate('save_tag',{id:t.id,name:`Renamed ${suffix}`});
  saved=(await snapshot()).tags.find(x=>x.id===t.id); assert.ok(saved.archived_at); assert.equal(saved.name,`Renamed ${suffix}`);
  await mutate('archive_tag',{id:t.id,archived:false}); assert.equal((await snapshot()).tags.find(x=>x.id===t.id).archived_at,null);
  await mutate('save_tag',tag({name:`ΟΣ ${suffix}`}));
  await assert.rejects(()=>mutate('save_tag',tag({name:`ος ${suffix}`})),/already exists/);
  await mutate('save_tag',tag({name:`İpek ${suffix}`})); await mutate('save_tag',tag({name:`Ipek ${suffix}`}));
  const invalid=tag(); for(const name of [null,'','A\nB','A\u0085B','A\u2029B','A'.repeat(61)]) await denied(()=>mutate('save_tag',{...invalid,name},owner,false));
});

test('tags enforce owner membership, immutable identity and private least-privilege access at SQL boundaries', async () => {
  const own=tag(),foreign=tag(); await mutate('save_tag',own); await mutate('save_tag',foreign,secondOwner);
  const e=entry({frequency:'monthly',end_date:'2026-02-28',tag_ids:[own.id]}), p=plan({tag_ids:[own.id]});
  await mutate('save_entry',e); await mutate('save_plan',p);
  const series=(await snapshot()).entries.find(x=>x.id===e.id).series_id;
  await denied(()=>mutate('save_entry',{...e,tag_ids:[foreign.id]}),'P0002');
  await denied(()=>mutate('save_plan',{...p,tag_ids:[foreign.id]}),'P0002');
  await denied(()=>mutate('save_tag',{id:foreign.id,name:'Hijacked'}),'P0002');
  await denied(()=>mutate('archive_tag',{id:foreign.id,archived:true}),'P0002');
  for(const [table,id] of [['finance_entries',e.id],['finance_series',series],['finance_plans',p.id]]) {
    await denied(()=>db.query(`update public.${table} set tag_ids=array[$1::uuid] where id=$2`,[foreign.id,id]),'23503');
  }
  await denied(()=>db.query('update public.finance_tags set user_id=$1 where id=$2',[secondOwner,own.id]));
  await denied(()=>db.query('update public.finance_tags set id=$1 where id=$2',[randomUUID(),own.id]));
  assert.equal((await snapshot(secondOwner)).tags.some(x=>x.id===own.id),false);
  for(const actor of [support,banned,unverified]) await denied(()=>mutate('save_tag',tag(),actor),'42501');
  await db.exec('set role service_role');
  try {
    const serviceTag=tag(); await mutate('save_tag',serviceTag); await mutate('save_entry',entry({tag_ids:[serviceTag.id]}));
    await denied(()=>db.query('delete from public.finance_tags where id=$1',[serviceTag.id]),'42501');
    for(const privilege of ['DELETE','TRUNCATE','REFERENCES','TRIGGER']) assert.equal((await one("select has_table_privilege('service_role','public.finance_tags',$1) granted",[privilege])).granted,false,privilege);
  } finally { await db.exec('reset role'); }
  for(const role of ['anon','authenticated']) assert.equal((await one("select has_table_privilege($1,'public.finance_tags','SELECT,INSERT,UPDATE,DELETE') granted",[role])).granted,false);
});

test('bill and income tag edits preserve money and payment snapshots, keep omitted tags and clear explicit empty sets', async () => {
  const first=tag(),second=tag(); await mutate('save_tag',first); await mutate('save_tag',second);
  const bill=entry({tag_ids:[second.id,first.id,first.id]}),income=entry({kind:'income',tag_ids:[first.id]});
  await mutate('save_entry',bill); await mutate('save_entry',income);
  const payment={id:randomUUID(),entry_id:bill.id,amount_cents:2500,paid_on:'2026-01-15'}; await mutate('record_payment',payment);
  const before=await snapshot(); assert.deepEqual(before.entries.find(x=>x.id===bill.id).tag_ids,[first.id,second.id].sort());
  const {tag_ids,...olderForm}=bill; await mutate('save_entry',{...olderForm,notes:'Same tags from an older form'});
  assert.deepEqual((await snapshot()).entries.find(x=>x.id===bill.id).tag_ids,[first.id,second.id].sort());
  await mutate('save_entry',{...bill,tag_ids:[]}); await mutate('save_entry',{...income,tag_ids:[second.id]});
  const after=await snapshot(); assert.deepEqual(after.entries.find(x=>x.id===bill.id).tag_ids,[]); assert.deepEqual(after.entries.find(x=>x.id===income.id).tag_ids,[second.id]);
  assert.deepEqual(after.payments,before.payments);
  for(const id of [bill.id,income.id]) for(const field of ['amount_cents','original_amount_cents','original_due_date','scheduled_date','status']) assert.equal(after.entries.find(x=>x.id===id)[field],before.entries.find(x=>x.id===id)[field]);
  const history=(await db.query("select details from public.finance_entry_history where entry_id=$1 and action='edited' order by created_at desc",[bill.id])).rows;
  assert.deepEqual(history[0].details.previous_tag_ids,[first.id,second.id].sort()); assert.deepEqual(history[0].details.tag_ids,[]);
});

test('archived tags remain on existing records and inherited schedules but cannot be newly assigned', async () => {
  const t=tag(); await mutate('save_tag',t);
  const e=entry({frequency:'monthly',end_date:'2026-03-31',tag_ids:[t.id]}); await mutate('save_entry',e);
  const s=await snapshot(owner,'2026-01-31'), original=s.entries.find(x=>x.id===e.id);
  await mutate('archive_tag',{id:t.id,archived:true});
  assert.deepEqual((await snapshot(owner,'2026-01-31')).entries.find(x=>x.id===e.id),original,'Archiving only changes the tag record');
  await mutate('save_entry',{...e,title:'Existing archived tag kept'});
  await denied(()=>mutate('save_entry',entry({tag_ids:[t.id]})));
  await denied(()=>mutate('save_plan',plan({tag_ids:[t.id]})));
  const expanded=await snapshot(owner,'2026-03-31');
  assert.equal(expanded.entries.filter(x=>x.series_id===original.series_id).length,3);
  assert.ok(expanded.entries.filter(x=>x.series_id===original.series_id).every(x=>x.tag_ids.length===1 && x.tag_ids[0]===t.id));
  await mutate('save_entry',{...e,tag_ids:[]}); await denied(()=>mutate('save_entry',e));
  await mutate('archive_tag',{id:t.id,archived:false}); await mutate('save_entry',e);
  assert.deepEqual((await snapshot()).entries.find(x=>x.id===e.id).tag_ids,[t.id]);
});

test('plan tag changes follow previous defaults across statuses while preserving customized children and cash', async () => {
  const a=tag(),b=tag(),custom=tag(); for(const t of [a,b,custom]) await mutate('save_tag',t);
  const p=plan({total_amount_cents:15000,opening_paid_cents:0,tag_ids:[a.id]}); await mutate('save_plan',p);
  let children=(await snapshot()).entries.filter(x=>x.plan_id===p.id);
  await mutate('record_payment',{id:randomUUID(),entry_id:children[0].id,amount_cents:3000,paid_on:'2026-01-15'});
  await mutate('save_entry',{...children[1],tag_ids:[custom.id]});
  await mutate('entry_status',{id:children[2].id,status:'cancelled'});
  await mutate('transfer_collections',{entry_id:children[3].id,collector:'Installment collector'});
  await mutate('entry_status',{id:children[4].id,status:'active',archived:true});
  const before=await snapshot(); await mutate('save_plan',{...p,tag_ids:[b.id]}); const after=await snapshot();
  children=after.entries.filter(x=>x.plan_id===p.id);
  assert.deepEqual(after.plans.find(x=>x.id===p.id).tag_ids,[b.id]);
  for(const child of children) assert.deepEqual(child.tag_ids,child.id===before.entries.filter(x=>x.plan_id===p.id)[1].id?[custom.id]:[b.id]);
  assert.deepEqual(after.payments,before.payments); assert.deepEqual(after.debts,before.debts);
  for(const child of children) for(const field of ['amount_cents','original_amount_cents','original_due_date','scheduled_date','status','archived_at','account_id','payment_method']) assert.equal(child[field],before.entries.find(x=>x.id===child.id)[field]);
  const historyCount=(await one("select count(*)::int n from public.finance_entry_history h join public.finance_entries e on e.id=h.entry_id where e.plan_id=$1 and h.action='tags_changed'",[p.id])).n;
  assert.equal(historyCount,4);
  await mutate('save_plan',{...p,tag_ids:[b.id]}); const {tag_ids,...oldForm}=p; await mutate('save_plan',{...oldForm,notes:'Do not overwrite child labels'});
  assert.equal((await one("select count(*)::int n from public.finance_entry_history h join public.finance_entries e on e.id=h.entry_id where e.plan_id=$1 and h.action='tags_changed'",[p.id])).n,historyCount);
  assert.deepEqual((await snapshot()).entries.find(x=>x.id===children[1].id).tag_ids,[custom.id]);
});

test('series inherit tags through every expansion branch while occurrence edits remain local', async () => {
  const a=tag(),b=tag(); await mutate('save_tag',a); await mutate('save_tag',b);
  const repeats=[
    entry({frequency:'weekly',tag_ids:[a.id],end_date:'2026-03-31'}),
    entry({frequency:'custom',custom_mode:'month_days',custom_month_days:[15,31],tag_ids:[a.id],end_date:'2026-03-31'}),
    entry({frequency:'custom',custom_mode:'specific_dates',custom_dates:['2026-01-15','2026-02-15','2026-03-15'],tag_ids:[a.id]})
  ];
  for(const e of repeats) {
    await mutate('save_entry',e); const first=(await snapshot(owner,'2026-01-31')).entries.find(x=>x.id===e.id);
    await mutate('save_entry',{...first,frequency:'once',tag_ids:[b.id]});
    const s=await snapshot(owner,'2026-03-31'), children=s.entries.filter(x=>x.series_id===first.series_id);
    assert.ok(children.length>1); assert.deepEqual(s.series.find(x=>x.id===first.series_id).tag_ids,[a.id]);
    assert.deepEqual(children.find(x=>x.id===e.id).tag_ids,[b.id]); assert.ok(children.filter(x=>x.id!==e.id).every(x=>x.tag_ids.length===1 && x.tag_ids[0]===a.id));
  }
});

test('quarterly bills, income and plans stay anchored through short months and leap years', async () => {
  assert.deepEqual((await db.query("select public.finance_occurrence_date('2026-08-31','quarterly',n)::text d from generate_series(0,4) n")).rows.map(x=>x.d),['2026-08-31','2026-11-30','2027-02-28','2027-05-31','2027-08-31']);
  assert.equal((await one("select public.finance_occurrence_date('2027-11-30','quarterly',1)::text d")).d,'2028-02-29');
  const t=tag(); await mutate('save_tag',t);
  for(const kind of ['bill','income']) {
    const e=entry({kind,frequency:'quarterly',original_due_date:'2026-01-31',scheduled_date:'2026-01-31',end_date:'2027-01-31',tag_ids:[t.id]}); await mutate('save_entry',e);
    const s=await snapshot(owner,'2027-02-28'), series=s.entries.find(x=>x.id===e.id).series_id;
    assert.deepEqual(s.entries.filter(x=>x.series_id===series).map(x=>x.original_due_date),['2026-01-31','2026-04-30','2026-07-31','2026-10-31','2027-01-31']);
    assert.ok(s.entries.filter(x=>x.series_id===series).every(x=>x.tag_ids[0]===t.id));
  }
  const p=plan({frequency:'quarterly',tag_ids:[t.id]}); await mutate('save_plan',p);
  let children=(await snapshot()).entries.filter(x=>x.plan_id===p.id);
  assert.deepEqual(children.map(x=>x.original_due_date),['2026-01-31','2026-04-30','2026-07-31','2026-10-31']);
  assert.equal(children.reduce((sum,x)=>sum+x.amount_cents,0),9001); assert.equal(children.at(-1).amount_cents,1);
  await mutate('move_entry',{id:children[1].id,scheduled_date:'2026-05-08'});
  children=(await snapshot(owner,'2027-12-31')).entries.filter(x=>x.plan_id===p.id);
  assert.equal(children[1].original_due_date,'2026-04-30'); assert.equal(children[1].scheduled_date,'2026-05-08'); assert.equal(children.length,4);
});

test('earlier custom input includes the entered first date and canonicalizes due dates without losing explicit moves', () => {
  const e=entry({frequency:'custom',custom_mode:'specific_dates',original_due_date:'2026-11-15',scheduled_date:'2026-11-15',custom_dates:['2026-09-15','2026-07-15','2026-09-15'],end_date:'2026-11-15'});
  const clean=validateFinanceMutation('save_entry',e).payload;
  assert.deepEqual(clean.custom_dates,['2026-07-15','2026-09-15','2026-11-15']); assert.equal(clean.original_due_date,'2026-07-15'); assert.equal(clean.scheduled_date,'2026-07-15');
  assert.equal(validateFinanceMutation('save_entry',{...e,scheduled_date:'2026-11-22'}).payload.scheduled_date,'2026-11-22');
  assert.deepEqual(validateFinanceMutation('save_entry',{...e,custom_dates:[]}).payload.custom_dates,['2026-11-15']);
  for(const change of [{custom_dates:null},{custom_dates:['1999-12-31']},{custom_dates:['2026-02-30']},{end_date:'2026-10-31'},{custom_dates:['2026-12-15']}]) assert.throws(()=>validateFinanceMutation('save_entry',{...e,...change}));
  const twoForty=Array.from({length:240},(_,i)=>new Date(Date.UTC(2026,0,1+i,12)).toISOString().slice(0,10));
  assert.throws(()=>validateFinanceMutation('save_entry',{...e,custom_dates:twoForty,end_date:null}),/240/,'The original chosen date consumes a slot if it is not in the date list');
});

test('earlier custom SQL creation and retries produce one tagged unpaid history with immutable occurrence dates', async () => {
  const t=tag(); await mutate('save_tag',t);
  const e=entry({frequency:'custom',custom_mode:'specific_dates',original_due_date:'2026-11-15',scheduled_date:'2026-11-15',custom_dates:['2026-09-15','2026-07-15'],tag_ids:[t.id],end_date:'2026-11-15'});
  await mutate('save_entry',e,owner,false); let s=await snapshot(), first=s.entries.find(x=>x.id===e.id),series=s.series.find(x=>x.id===first.series_id);
  assert.equal(first.original_due_date,'2026-07-15'); assert.equal(first.scheduled_date,'2026-07-15'); assert.equal(series.start_date,'2026-07-15');
  assert.deepEqual(series.custom_dates,['2026-07-15','2026-09-15','2026-11-15']);
  let children=s.entries.filter(x=>x.series_id===series.id); assert.equal(children.length,3); assert.ok(children.every(x=>x.status==='active' && x.tag_ids[0]===t.id));
  assert.equal(s.payments.filter(x=>children.some(e=>e.id===x.entry_id)).length,0);
  await mutate('save_entry',e,owner,false); await mutate('save_entry',e); s=await snapshot();
  assert.equal(s.series.filter(x=>x.id===series.id).length,1); assert.equal(s.entries.filter(x=>x.series_id===series.id).length,3);
  const oldChild=s.entries.find(x=>x.series_id===series.id && x.original_due_date==='2026-09-15');
  await mutate('move_entry',{id:oldChild.id,scheduled_date:'2026-11-20'});
  await denied(()=>mutate('save_entry',{...oldChild,original_due_date:'2026-09-16'}));
  children=(await snapshot()).entries.filter(x=>x.series_id===series.id); assert.equal(children.find(x=>x.id===oldChild.id).scheduled_date,'2026-11-20');
  const moved=entry({...e,id:randomUUID(),scheduled_date:'2026-11-22'}); await mutate('save_entry',moved,owner,false);
  assert.equal((await snapshot()).entries.find(x=>x.id===moved.id).scheduled_date,'2026-11-22');
});

test('tag and recurrence failures leave no partial series, plans or altered financial state', async () => {
  const t=tag(); await mutate('save_tag',t);
  const before=await snapshot();
  await denied(()=>mutate('save_entry',entry({frequency:'monthly',tag_ids:[randomUUID()]})),'P0002');
  await denied(()=>mutate('save_plan',plan({frequency:'quarterly',first_due_date:'2100-10-31',tag_ids:[t.id]})),'23514');
  await denied(()=>mutate('save_entry',entry({frequency:'custom',custom_mode:'specific_dates',original_due_date:'2026-11-15',scheduled_date:'2026-11-15',custom_dates:['2026-07-15'],end_date:'2026-10-31',tag_ids:[t.id]}),owner,false));
  await denied(()=>mutate('save_entry',entry({tag_ids:[null]}),owner,false));
  assert.deepEqual(await snapshot(),before);
  const ownIds=[]; for(let i=0;i<21;i++) {const next=tag(); await mutate('save_tag',next); ownIds.push(next.id);}
  await denied(()=>mutate('save_entry',entry({tag_ids:ownIds}),owner,false));
});

test('tag migration reapplication preserves quarterly schedules, archived links, customized installments and money', async () => {
  const before=await snapshot(); await db.exec(tagsMigration); assert.deepEqual(await snapshot(),before);
  assert.equal((await one("select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname like 'finance_%'")).n,17);
  assert.equal((await one("select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'finance_%'")).n,18);
  assert.equal((await one("select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'finance_%' and (prosecdef or has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE'))")).n,0);
  assert.equal((await one("select has_table_privilege('service_role','public.finance_tags','DELETE,TRUNCATE,REFERENCES,TRIGGER') granted")).granted,false);
});
