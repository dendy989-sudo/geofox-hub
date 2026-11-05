import { remainingAmount } from "./calculations.ts";
import type { FinanceData, FinanceEntry } from "./types";

export interface BillReminder {
  entry: FinanceEntry;
  remaining_cents: number;
  state: "past_due" | "today" | "upcoming" | "snoozed";
  reminder_date: string;
  original_past_due: boolean;
}
export function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export function financeToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
function eligible(data: FinanceData, entry: FinanceEntry): boolean {
  return entry.user_id === data.user.id && entry.kind === "bill" && entry.status === "active" && entry.reminder_days != null && remainingAmount(entry, data.payments) > 0;
}
/** Reminders follow the planned payment date; the original obligation is preserved. */
export function billReminders(data: FinanceData, today = data.today): BillReminder[] {
  return data.entries.filter(entry => eligible(data, entry)).flatMap(entry => {
    const reminderDate = shiftDate(entry.scheduled_date, -(entry.reminder_days ?? 0));
    if (reminderDate > today) return [];
    return [{ entry, remaining_cents: remainingAmount(entry, data.payments), reminder_date: reminderDate,
      state: entry.reminder_snoozed_until && entry.reminder_snoozed_until > today ? "snoozed" as const : entry.scheduled_date < today ? "past_due" as const : entry.scheduled_date === today ? "today" as const : "upcoming" as const,
      original_past_due: entry.original_due_date < today,
    }];
  }).sort((a, b) => a.entry.scheduled_date.localeCompare(b.entry.scheduled_date) || a.entry.title.localeCompare(b.entry.title));
}
export function reminderCount(data: FinanceData): number { return billReminders(data).filter(item => item.state !== "snoozed").length; }
export function calendarReminderEntries(data: FinanceData, month: string): FinanceEntry[] {
  return data.entries.filter(entry => eligible(data, entry) && entry.scheduled_date.startsWith(`${month}-`)).sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date));
}
function escapeCalendar(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/\\/g, "\\\\").replace(/\r\n|\r|\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,");
}
function foldCalendarLine(line: string): string {
  const encoder = new TextEncoder();
  let result = "", width = 0;
  for (const character of line) {
    const size = encoder.encode(character).length;
    if (width + size > 75) { result += "\r\n "; width = 1; }
    result += character; width += size;
  }
  return result;
}
/** RFC 5545: floating 09:00 events use the importing device's local time. */
export function remindersCalendar(data: FinanceData, month: string, now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Geofox Apps//Finance reminders//EN", "CALSCALE:GREGORIAN", "X-WR-CALNAME:Geofox bill reminders"];
  for (const entry of calendarReminderEntries(data, month)) {
    const amount = (remainingAmount(entry, data.payments) / 100).toFixed(2);
    let offset = -(entry.reminder_days ?? 0);
    if (entry.reminder_snoozed_until) {
      const snoozeOffset = Math.round((Date.parse(`${entry.reminder_snoozed_until}T12:00:00Z`) - Date.parse(`${entry.scheduled_date}T12:00:00Z`)) / 86400000);
      offset = Math.max(offset, snoozeOffset);
    }
    const trigger = offset === 0 ? "PT0S" : `${offset < 0 ? "-" : ""}P${Math.abs(offset)}D`;
    const description = `Remaining: $${amount} USD. Planned payment: ${entry.scheduled_date}. Original due date: ${entry.original_due_date}. ${entry.scheduled_date !== entry.original_due_date ? "Moved payment; original due date remains unchanged. " : ""}This is an exported snapshot. Check Geofox Finance for current status and re-export after changes.`;
    lines.push("BEGIN:VEVENT", `UID:${entry.id}@finance.geofoxapps.com`, `DTSTAMP:${stamp}`, `DTSTART:${entry.scheduled_date.replaceAll("-", "")}T090000`, "DURATION:PT15M", `SUMMARY:${escapeCalendar(`Bill: ${entry.title}`)}`, `DESCRIPTION:${escapeCalendar(description)}`, "CLASS:PRIVATE", "TRANSP:TRANSPARENT", "STATUS:CONFIRMED", "URL:https://www.geofoxapps.com/finance#reminders", "BEGIN:VALARM", "ACTION:DISPLAY", `TRIGGER:${trigger}`, `DESCRIPTION:${escapeCalendar(`Bill reminder: ${entry.title}`)}`, "END:VALARM", "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(foldCalendarLine).join("\r\n")}\r\n`;
}
