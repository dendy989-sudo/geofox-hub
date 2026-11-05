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

// Shared in-memory database is intentional: every write is scoped to a distinct ID.
test('migrations are repeatable under Supabase default grants, all tables use RLS, functions are invokers, browser roles cannot access finance', async () => {
  await db.exec(migration);
  await db.exec(readonlyMigration);
  assert.deepEqual((await db.query('select user_id from public.finance_access')).rows.map(r=>r.user_id), [owner]);
  const tables = (await db.query("select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relname like 'finance_%' and relkind='r'")).rows;
  assert.equal(tables.length,10); assert.ok(tables.every(t=>t.relrowsecurity));
  const functions=(await db.query("select proname,prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname like 'finance_%'")).rows;
  assert.equal(functions.length,5); assert.ok(functions.every(f=>f.prosecdef===false));
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
