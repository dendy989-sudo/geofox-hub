import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const staff = randomUUID();
const alice = randomUUID();
const bob = randomUUID();
const hash = value => createHash("sha256").update(value).digest("hex");
await db.exec("create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,banned_until timestamptz,deleted_at timestamptz);");
await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,'staff@example.test',now())", [staff]);
await db.exec(await readFile(new URL("../migrations/202611030001_geofox_hub.sql", import.meta.url), "utf8"));
// Upgrade fixture: a historical staff note survives its author's Auth deletion.
const oldTicket = randomUUID(), removedStaff = randomUUID();
await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,'removed@example.test',now())", [removedStaff]);
await db.query("insert into public.hub_tickets(id,app_slug,email,subject) values($1,'novanook','guest@example.test','Historical request')", [oldTicket]);
await db.query("insert into public.hub_ticket_messages(ticket_id,body,author_id,author_name,internal) values($1,'Historical internal note',$2,'Former staff',true)", [oldTicket, removedStaff]);
await db.query("delete from auth.users where id=$1", [removedStaff]);
const migration = await readFile(new URL("../migrations/20261103134124_customer_app_support.sql", import.meta.url), "utf8");
await db.exec(migration);
await db.query("insert into public.hub_staff(user_id,display_name,role) values($1,'Private Staff Name','owner')", [staff]);
await db.exec("insert into public.hub_apps(slug,name,website) values('otherapp','Other app','https://example.test')");
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const denied = async (operation, code) => assert.rejects(operation, error => error.code === code);
async function create(customer = randomUUID(), app = "novanook", request = randomUUID(), overrides = {}) {
  const values = { subject: "A support question", body: "Please help with this account.", category: "general", ...overrides };
  return (await one("select public.hub_customer_create_ticket($1,$2,$3,$4,$5,$6,$7,$8,$9) result",
    [app, customer, "confirmed@example.test", values.subject, values.body, values.category, request, hash("create:" + customer), hash("create-ip:" + customer)])).result;
}
async function list(customer, app = "novanook", limit = 20, cursor = null) {
  return (await one("select public.hub_customer_list_tickets($1,$2,$3,$4,$5) result",
    [app, customer, limit, cursor?.createdAt || null, cursor?.id || null])).result;
}
async function detail(customer, ticket, app = "novanook", cursor = null) {
  return (await one("select public.hub_customer_ticket_detail($1,$2,$3,$4,$5) result",
    [app, customer, ticket, cursor?.createdAt || null, cursor?.id || null])).result;
}
async function reply(customer, ticket, request = randomUUID(), body = "A follow-up message", app = "novanook") {
  return (await one("select public.hub_customer_reply($1,$2,$3,$4,$5,$6,$7) result",
    [app, customer, ticket, body, request, hash("reply:" + customer), hash("reply-ip:" + customer)])).result;
}
let aliceTicket;

test("customer schema is additive, repeatable, private, and has no public execution grants", async () => {
  await db.exec(migration);
  const table = await one("select relrowsecurity from pg_class where oid='public.hub_customer_requests'::regclass");
  assert.equal(table.relrowsecurity, true);
  assert.equal((await one("select author_kind from public.hub_ticket_messages where ticket_id=$1", [oldTicket])).author_kind, "staff");
  for (const role of ["anon", "authenticated"]) {
    await db.exec("set role " + role);
    try {
      await denied(() => db.query("select * from public.hub_customer_requests"), "42501");
      await denied(() => list(alice), "42501");
      await denied(() => create(alice), "42501");
      await denied(() => detail(alice, randomUUID()), "42501");
      await denied(() => reply(alice, randomUUID()), "42501");
      await denied(() => db.query("select public.hub_staff_ticket_messages($1,$2)", [staff, oldTicket]), "42501");
      await denied(() => db.query("select public.hub_add_ticket_message_once($1,$2,'Reply',false,'not_requested',$3)", [staff, oldTicket, randomUUID()]), "42501");
    } finally { await db.exec("reset role"); }
  }
});

test("verified app ownership isolates users and apps and never claims public-form tickets", async () => {
  aliceTicket = await create(alice);
  const other = await create(alice, "otherapp");
  const b = await create(bob);
  const guest = (await one("select public.hub_create_public_ticket('novanook','confirmed@example.test','Claimed identity','Someone typed this customer UUID',$1,$2,'general',$3) result",
    [hash("guest-ip"), hash("guest-email"), alice])).result;
  assert.deepEqual((await list(alice)).items.map(ticket => ticket.id), [aliceTicket.id]);
  assert.deepEqual((await list(alice, "otherapp")).items.map(ticket => ticket.id), [other.id]);
  for (const target of [b.id, other.id, guest.id, randomUUID()]) {
    await denied(() => detail(alice, target), "P0100");
    await denied(() => reply(alice, target), "P0100");
  }
  await denied(() => detail(bob, aliceTicket.id), "P0100");
  const row = await one("select customer_owner_id,customer_id,identity_verified,source from public.hub_tickets where id=$1", [aliceTicket.id]);
  assert.deepEqual(row, { customer_owner_id: alice, customer_id: alice, identity_verified: true, source: "app" });
  await denied(() => db.query("update public.hub_tickets set customer_owner_id=$1::uuid,customer_id=$1::uuid::text where id=$2", [bob, aliceTicket.id]), "22023");
});

test("customer responses omit private messages, staff details, identifiers, audit and private timestamps", async () => {
  await db.query("update public.hub_tickets set customer_updated_at='2025-01-01T00:00:00Z' where id=$1", [aliceTicket.id]);
  const before = await detail(alice, aliceTicket.id);
  await db.query("select public.hub_add_ticket_message($1,$2,'PRIVATE INTERNAL NOTE',true,'not_requested')", [staff, aliceTicket.id]);
  const withNote = await detail(alice, aliceTicket.id);
  assert.equal(withNote.updatedAt, before.updatedAt);
  assert.equal(withNote.messages.length, before.messages.length);
  await db.query("select public.hub_add_ticket_message($1,$2,'A public support reply',false,'not_requested')", [staff, aliceTicket.id]);
  const result = await detail(alice, aliceTicket.id);
  assert.deepEqual(Object.keys(result).sort(), ["appName","appSlug","category","createdAt","id","messages","nextMessagesCursor","reference","status","subject","updatedAt"].sort());
  for (const message of result.messages) assert.deepEqual(Object.keys(message).sort(), ["id", "body", "author", "createdAt"].sort());
  const serialized = JSON.stringify(result);
  for (const privateValue of ["PRIVATE INTERNAL NOTE","Private Staff Name","confirmed@example.test",staff,alice,"audit","assignee"]) assert.equal(serialized.includes(privateValue), false, privateValue);
  assert.equal(result.messages.at(-1).author, "support");
  assert.notEqual(result.updatedAt, before.updatedAt);
  await denied(() => db.query("insert into public.hub_ticket_messages(ticket_id,body,author_kind,customer_author_id) values($1,'Spoofed author','customer',$2)", [aliceTicket.id, bob]), "42501");
  await denied(() => db.query("insert into public.hub_ticket_messages(ticket_id,body,author_kind,customer_author_id,internal) values($1,'Private customer note','customer',$2,true)", [aliceTicket.id, alice]), "23514");
});

test("concurrent create retries commit one complete ticket and conflicting payloads fail", async () => {
  const customer = randomUUID(), request = randomUUID();
  const attempts = await Promise.all(Array.from({ length: 5 }, () => create(customer, "novanook", request)));
  assert.equal(new Set(attempts.map(item => item.id)).size, 1);
  assert.equal(attempts.filter(item => !item.replayed).length, 1);
  assert.equal((await list(customer)).items.length, 1);
  assert.equal(attempts[0].messages.length, 1);
  await denied(() => create(customer, "novanook", request, { body: "Changed retry content" }), "P0101");
  await denied(() => reply(customer, attempts[0].id, request), "P0101");
  const records = await one("select count(*)::int n from public.hub_customer_requests where customer_owner_id=$1", [customer]);
  assert.equal(records.n, 1);
});

test("reply retries are idempotent and closed/resolved statuses have deliberate behavior", async () => {
  const customer = randomUUID(), ticket = await create(customer), request = randomUUID();
  await db.query("update public.hub_tickets set status='resolved' where id=$1", [ticket.id]);
  const results = await Promise.all(Array.from({ length: 5 }, () => reply(customer, ticket.id, request)));
  assert.equal(new Set(results.map(item => item.message.id)).size, 1);
  assert.equal(results.filter(item => !item.replayed).length, 1);
  assert.equal(results[0].ticketStatus, "open");
  await denied(() => reply(customer, ticket.id, request, "Changed retry"), "P0101");
  await db.query("update public.hub_tickets set status='closed' where id=$1", [ticket.id]);
  assert.equal((await reply(customer, ticket.id, request)).replayed, true);
  await denied(() => reply(customer, ticket.id), "P0102");
  for (const [status, expected] of [["waiting_customer","open"], ["in_progress","in_progress"]]) {
    await db.query("update public.hub_tickets set status=$1 where id=$2", [status, ticket.id]);
    assert.equal((await reply(customer, ticket.id)).ticketStatus, expected);
  }
});

test("atomic creation and reply limits reject excess attempts without orphan messages or requests", async () => {
  const customer = randomUUID();
  const attempts = await Promise.allSettled(Array.from({ length: 7 }, () => create(customer)));
  assert.equal(attempts.filter(item => item.status === "fulfilled").length, 5);
  assert.equal(attempts.filter(item => item.status === "rejected" && item.reason.code === "P0103").length, 2);
  assert.equal((await list(customer)).items.length, 5);
  const ticket = attempts.find(item => item.status === "fulfilled").value;
  await db.query("insert into public.hub_rate_limits(key_hash,window_start,hits) values($1,now(),60)", [hash("reply:" + customer)]);
  const before = await one("select count(*)::int n from public.hub_ticket_messages where ticket_id=$1", [ticket.id]);
  await denied(() => reply(customer, ticket.id), "P0103");
  assert.deepEqual(await one("select count(*)::int n from public.hub_ticket_messages where ticket_id=$1", [ticket.id]), before);
  assert.equal((await one("select count(*)::int n from public.hub_customer_requests where customer_owner_id=$1", [customer])).n, 5);
});

test("bounded keyset pages retain microsecond precision and hide private messages on every page", async () => {
  const customer = randomUUID();
  await db.query("insert into public.hub_tickets(app_slug,email,subject,customer_id,customer_owner_id,identity_verified,source,created_at) select 'novanook','confirmed@example.test','Paging ticket '||n,$1::uuid::text,$1::uuid,true,'app','2026-01-01T00:00:00Z'::timestamptz+n*interval '1 microsecond' from generate_series(1,27) n", [customer]);
  const first = await list(customer, "novanook", 25);
  const next = await list(customer, "novanook", 25, first.nextCursor);
  assert.equal(first.items.length, 25);
  assert.equal(next.items.length, 2);
  assert.equal(next.nextCursor, null);
  assert.equal(new Set([...first.items, ...next.items].map(item => item.id)).size, 27);
  const ticket = first.items[0].id;
  await db.query("insert into public.hub_ticket_messages(ticket_id,body,author_kind,customer_author_id,created_at) select $1,'Message '||n,'customer',$2,'2026-01-01T00:00:00Z'::timestamptz+n*interval '1 microsecond' from generate_series(1,53) n", [ticket, customer]);
  await db.query("select public.hub_add_ticket_message($1,$2,'PRIVATE PAGINATED NOTE',true,'not_requested')", [staff, ticket]);
  const last = await detail(customer, ticket);
  const older = await detail(customer, ticket, "novanook", last.nextMessagesCursor);
  assert.equal(last.messages.length, 50);
  assert.equal(older.messages.length, 3);
  assert.equal(older.nextMessagesCursor, null);
  assert.equal(new Set([...last.messages, ...older.messages].map(item => item.id)).size, 53);
  assert.equal(JSON.stringify([last, older]).includes("PRIVATE PAGINATED NOTE"), false);
  await denied(() => list(customer, "novanook", 26), "22023");
  await db.exec("update public.hub_apps set active=false where slug='otherapp'");
  await denied(() => list(customer, "otherapp"), "P0100");
});

test("staff publication retries preserve delivery state and still enforce current access", async () => {
  const ticket = await create(), request = randomUUID();
  const publish = body => one("select public.hub_add_ticket_message_once($1,$2,$3,false,'not_requested',$4) result", [staff, ticket.id, body, request]);
  const first = (await publish("Staff reply in app")).result;
  assert.equal(first.replayed, false);
  await db.query("update public.hub_ticket_messages set delivery_status='sent' where id=$1", [first.id]);
  const second = (await publish("Staff reply in app")).result;
  assert.equal(second.replayed, true);
  assert.equal(second.id, first.id);
  assert.equal((await one("select delivery_status from public.hub_ticket_messages where id=$1", [first.id])).delivery_status, "sent");
  await denied(() => publish("Changed retry"), "P0101");
  await db.query("update public.hub_staff set active=false where user_id=$1", [staff]);
  try { await denied(() => publish("Staff reply in app"), "42501"); }
  finally { await db.query("update public.hub_staff set active=true where user_id=$1", [staff]); }
});

test("staff receives newest messages in long threads and can retrieve every older page", async () => {
  const customer = randomUUID(), ticket = await create(customer);
  await db.query("insert into public.hub_ticket_messages(ticket_id,body,author_kind,customer_author_id,created_at) select $1,'Long thread message '||n,'customer',$2,clock_timestamp()+n*interval '1 microsecond' from generate_series(1,501) n", [ticket.id, customer]);
  await db.query("select public.hub_add_ticket_message($1,$2,'Private staff context',true,'not_requested')", [staff, ticket.id]);
  const page = async cursor => (await one("select public.hub_staff_ticket_messages($1,$2,$3,$4) result", [staff, ticket.id, cursor?.createdAt || null, cursor?.id || null])).result;
  let result = await page(null);
  assert.equal(result.messages.length, 100);
  assert.ok(result.messages.some(message => message.body === "Long thread message 501"));
  const all = [...result.messages];
  while (result.nextCursor) { result = await page(result.nextCursor); all.push(...result.messages); }
  assert.equal(all.length, 503);
  assert.equal(new Set(all.map(message => message.id)).size, 503);
  assert.equal(all.filter(message => message.internal).length, 1);
  await denied(() => db.query("select public.hub_staff_ticket_messages($1,$2)", [customer, ticket.id]), "42501");
  assert.equal(JSON.stringify(await detail(customer, ticket.id)).includes("Private staff context"), false);
});

test.after(async () => { await db.close(); });
