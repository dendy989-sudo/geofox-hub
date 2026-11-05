import assert from "node:assert/strict";
import test from "node:test";
import { billReminders, calendarReminderEntries, financeToday, reminderCount, remindersCalendar, shiftDate } from "../lib/finance/reminders.ts";

const timestamp = "2026-11-01T12:00:00Z";
function entry(id, changes = {}) {
  return { id, user_id: "owner", kind: "bill", title: id, amount_cents: 10000, original_amount_cents: 10000,
    original_due_date: "2026-11-10", scheduled_date: "2026-11-10", status: "active", archived_at: null,
    reminder_days: 3, reminder_snoozed_until: null, created_at: timestamp, updated_at: timestamp, ...changes };
}
function payment(id, entryId, amount, changes = {}) { return { id, user_id: "owner", entry_id: entryId, amount_cents: amount, paid_on: "2026-11-05", reversed_at: null, ...changes }; }
function data(changes = {}) { return { user: { id: "owner" }, today: "2026-11-10", entries: [], payments: [], ...changes }; }

test("reminders follow configured lead time across months and retain partial remaining amounts", () => {
  const fixture = data({ today: "2026-11-30", entries: [entry("partial", { scheduled_date: "2026-12-02" }), entry("later", { scheduled_date: "2026-12-05" })], payments: [payment("part", "partial", 3000)] });
  const result = billReminders(fixture);
  assert.equal(result.length, 1);
  assert.equal(result[0].state, "upcoming");
  assert.equal(result[0].reminder_date, "2026-11-29");
  assert.equal(result[0].remaining_cents, 7000);
  assert.equal(reminderCount(fixture), 1);
  assert.equal(shiftDate("2027-01-01", -3), "2026-12-29");
  assert.equal(shiftDate("2028-03-01", -1), "2028-02-29");
});

test("paid, cancelled, collection, income, disabled, and foreign records do not create alerts", () => {
  const fixture = data({ entries: [entry("paid"), entry("cancelled", { status: "cancelled" }), entry("collections", { status: "collections" }), entry("income", { kind: "income" }), entry("off", { reminder_days: null }), entry("foreign", { user_id: "other" }), entry("archived", { archived_at: timestamp })], payments: [payment("full", "paid", 10000)] });
  assert.deepEqual(billReminders(fixture).map(item => item.entry.id), ["archived"], "archiving keeps an unpaid obligation visible");
  fixture.payments[0].reversed_at = timestamp;
  assert.deepEqual(billReminders(fixture).map(item => item.entry.id), ["archived", "paid"]);
});

test("moved bills use the planned date but keep the original overdue flag", () => {
  const fixture = data({ entries: [entry("moved", { original_due_date: "2026-10-20", scheduled_date: "2026-11-12" }), entry("late", { scheduled_date: "2026-11-09" }), entry("today")] });
  const result = billReminders(fixture);
  assert.deepEqual(result.map(item => item.state), ["past_due", "today", "upcoming"]);
  assert.equal(result[2].original_past_due, true);
  assert.equal(result[2].entry.original_due_date, "2026-10-20");
});

test("snooze suppresses the alert count until the chosen day without moving the bill", () => {
  const fixture = data({ entries: [entry("snoozed", { reminder_snoozed_until: "2026-11-12" })] });
  assert.equal(billReminders(fixture)[0].state, "snoozed");
  assert.equal(reminderCount(fixture), 0);
  assert.equal(billReminders(fixture, "2026-11-12")[0].state, "past_due");
  assert.equal(fixture.entries[0].scheduled_date, "2026-11-10");
});

test("due-day-only reminders start on the bill date, not a day early", () => {
  const fixture = data({ today: "2026-11-09", entries: [entry("due-only", { reminder_days: 0 })] });
  assert.equal(billReminders(fixture).length, 0);
  assert.equal(billReminders(fixture, "2026-11-10")[0].state, "today");
});

test("calendar exports contain only selected month eligible bills and stable identifiers", () => {
  const fixture = data({ entries: [entry("a"), entry("b", { reminder_days: 0 }), entry("other-month", { scheduled_date: "2026-12-10" }), entry("paid"), entry("off", { reminder_days: null })], payments: [payment("full", "paid", 10000)] });
  assert.deepEqual(calendarReminderEntries(fixture, "2026-11").map(item => item.id), ["a", "b"]);
  const ics = remindersCalendar(fixture, "2026-11", new Date(timestamp));
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 2);
  assert.match(ics, /UID:a@finance\.geofoxapps\.com\r\n/);
  assert.match(ics, /DTSTAMP:20261101T120000Z/);
  assert.match(ics, /DTSTART:20261110T090000/);
  assert.match(ics, /TRIGGER:-P3D/);
  assert.match(ics, /TRIGGER:PT0S/);
  assert.match(ics, /CLASS:PRIVATE/);
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
});

test("calendar text is escaped and UTF-8 folded without injecting properties or corrupting text", () => {
  const title = `é🚀`.repeat(35) + ",rent;\\note\r\nBEGIN:VEVENT\u0000";
  const fixture = data({ entries: [entry("unicode", { title })] });
  const ics = remindersCalendar(fixture, "2026-11", new Date(timestamp));
  for (const line of ics.split("\r\n")) assert.ok(Buffer.byteLength(line, "utf8") <= 75);
  const unfolded = ics.replace(/\r\n /g, "");
  assert.ok(unfolded.includes(`SUMMARY:Bill: ${`é🚀`.repeat(35)}\\,rent\\;\\\\note\\nBEGIN:VEVENT`));
  assert.equal((ics.match(/\r\nBEGIN:VEVENT\r\n/g) || []).length, 1);
  assert.ok(!ics.includes("\u0000"));
});

test("calendar alarms respect a snooze both before and after the scheduled date", () => {
  const fixture = data({ entries: [entry("before", { reminder_snoozed_until: "2026-11-09" }), entry("after", { reminder_snoozed_until: "2026-11-12" })] });
  const ics = remindersCalendar(fixture, "2026-11", new Date(timestamp));
  assert.match(ics, /TRIGGER:-P1D/);
  assert.match(ics, /TRIGGER:P2D/);
});

test("the finance day follows America/Chicago across midnight and daylight saving time", () => {
  assert.equal(financeToday(new Date("2026-11-05T05:30:00Z")), "2026-11-04");
  assert.equal(financeToday(new Date("2026-11-05T06:30:00Z")), "2026-11-05");
  assert.equal(financeToday(new Date("2026-07-05T05:30:00Z")), "2026-07-05");
});
