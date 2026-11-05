import assert from "node:assert/strict";
import test from "node:test";
import {
  dailyLedger, dayInMonth, debtSummary, entryState, isMoved, isPastDue, monthDays,
  monthOpening, monthSummary, paidAmount, parseMoney, planProgress, remainingAmount, shiftMonth,
} from "../lib/finance/calculations.ts";

const timestamp = "2026-11-01T12:00:00Z";

function entry(id, overrides = {}) {
  return {
    id, user_id: "owner", kind: "bill", title: id, category: "Home", expense_type: "bill",
    amount_cents: 10000, original_amount_cents: overrides.amount_cents ?? 10000,
    original_due_date: "2026-11-10", scheduled_date: overrides.original_due_date ?? "2026-11-10",
    status: "active", archived_at: null, series_id: null, plan_id: null, notes: "",
    created_at: timestamp, updated_at: timestamp, ...overrides,
  };
}

function payment(id, entryId, amount, date, overrides = {}) {
  return { id, user_id: "owner", entry_id: entryId, amount_cents: amount, paid_on: date, note: "", reversed_at: null, created_at: timestamp, ...overrides };
}

function data(overrides = {}) {
  return {
    user: { id: "owner", display_name: "Owner" }, today: "2026-11-15",
    entries: [], payments: [], series: [], plans: [], debts: [], debt_history: [], spending: [], months: [],
    ...overrides,
  };
}

function month(monthValue, opening = 0) {
  return { user_id: "owner", month: monthValue, opening_balance_cents: opening, updated_at: timestamp };
}

function plan(id, overrides = {}) {
  return {
    id, user_id: "owner", title: id, creditor: "Creditor", kind: "installment", category: "Debt payments",
    total_amount_cents: 30000, opening_paid_cents: 10000, installment_amount_cents: 10000,
    frequency: "monthly", first_due_date: "2026-11-10", status: "active", notes: "", created_at: timestamp,
    ...overrides,
  };
}

function debt(id, overrides = {}) {
  return {
    id, user_id: "owner", title: id, stage: "collections", original_creditor: "Creditor", collector: "Collector",
    original_balance_cents: 10000, current_balance_cents: 10000, status: "open", date_added: "2026-11-01", date_removed: null,
    settlement_offer_cents: null, offer_monthly_cents: null, offer_expires_on: null,
    source_entry_id: null, source_plan_id: null, notes: "", created_at: timestamp, updated_at: timestamp,
    ...overrides,
  };
}

function on(ledger, date) {
  const day = ledger.find((item) => item.date === date);
  assert.ok(day, `Expected ledger date ${date}`);
  return day;
}

test("money parsing uses exact cents, accepts explicit negative openings, and rejects ambiguous input", () => {
  for (const [input, expected] of [["0", 0], ["0.01", 1], ["0.29", 29], ["1.1", 110], [" 42.05 ", 4205], ["0002.09", 209], ["90071992547409.91", Number.MAX_SAFE_INTEGER]]) {
    assert.equal(parseMoney(input), expected, input);
  }
  assert.equal(parseMoney("-125.29", true), -12529);
  assert.equal(parseMoney("-0.00", true), 0);
  for (const input of ["", " ", "-1", "+1", ".99", "1.", "1,000", "$1", "1e3", "Infinity", "NaN", "1.001", "90071992547409.92", "90071992547410", "999999999999999999999999"]) {
    assert.equal(parseMoney(input), null, input);
  }
});

test("calendar helpers handle month/year ends and leap-century rules without normalizing invalid dates", () => {
  assert.equal(monthDays("2028-02").at(-1), "2028-02-29");
  assert.equal(monthDays("2027-02").length, 28);
  assert.equal(monthDays("1900-02").length, 28);
  assert.equal(monthDays("2000-02").length, 29);
  assert.equal(monthDays("2026-04").length, 30);
  assert.equal(monthDays("2026-12").length, 31);
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("2028-02", -13), "2027-01");
  assert.equal(shiftMonth("0099-12", 1), "0100-01");
  assert.ok(dayInMonth("2028-02-29", "2028-02"));
  for (const date of ["2027-02-29", "2027-02-00", "2027-02-30", "2027-02-01T00:00:00Z", "2027-2-01", "2027-03-01"]) {
    assert.equal(dayInMonth(date, "2027-02"), false, date);
  }
  assert.equal(dayInMonth("2027-02-01", "invalid"), false);
  assert.throws(() => monthDays("2026-13"), RangeError);
  assert.throws(() => shiftMonth("2026-01", 0.5), RangeError);
  assert.throws(() => shiftMonth("0001-01", -1), RangeError);
});

test("date-only cash flow remains identical on both sides of local midnight and the date line", () => {
  const initialTimezone = process.env.TZ;
  const fixture = data({
    entries: [entry("midnight", { original_due_date: "2026-12-31", scheduled_date: "2027-01-01" })],
    months: [month("2027-01", 20000)],
  });
  try {
    for (const timezone of ["UTC", "America/Los_Angeles", "Pacific/Kiritimati"]) {
      process.env.TZ = timezone;
      const ledger = dailyLedger(fixture, "2027-01");
      assert.equal(ledger[0].date, "2027-01-01");
      assert.equal(ledger[0].ending_cents, 10000);
      assert.equal(ledger.at(-1).date, "2027-01-31");
      assert.equal(shiftMonth("2026-12", 1), "2027-01");
    }
  } finally {
    if (initialTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = initialTimezone;
  }
});

test("each month uses its explicit opening, with no implicit carry from a prior projected closing", () => {
  const fixture = data({ months: [month("2026-10", 90000), month("2026-11", -500)] });
  assert.equal(monthOpening(fixture, "2026-11"), -500);
  assert.equal(monthOpening(fixture, "2026-12"), 0);
  assert.equal(dailyLedger(fixture, "2026-11").length, 30);
  assert.ok(dailyLedger(fixture, "2026-11").every((day) => day.ending_cents === -500));
  const summary = monthSummary(fixture, "2026-12", "2026-11-15");
  assert.equal(summary.opening_cents, 0);
  assert.equal(summary.ending_cents, 0);
  assert.equal(summary.original_progress_percent, 0);
  assert.equal(summary.next_bill, null);
});

test("moving a bill shifts the forecast exactly once while preserving the original obligation and overdue state", () => {
  const bill = entry("rent", { scheduled_date: "2026-11-20" });
  const fixture = data({ entries: [bill], months: [month("2026-11", 20000)] });
  const ledger = dailyLedger(fixture, "2026-11");
  assert.equal(on(ledger, "2026-11-10").bills_cents, 0);
  assert.equal(on(ledger, "2026-11-19").ending_cents, 20000);
  assert.equal(on(ledger, "2026-11-20").bills_cents, 10000);
  assert.equal(ledger.at(-1).ending_cents, 10000);
  assert.ok(isMoved(bill));
  assert.ok(isPastDue(bill, [], "2026-11-15"));
  assert.equal(entryState(bill, [], "2026-11-15"), "past_due");
  assert.equal(monthSummary(fixture, "2026-11", "2026-11-15").original_bills_cents, 10000);
  const restored = { ...bill, scheduled_date: bill.original_due_date };
  assert.equal(isMoved(restored), false);
  assert.equal(on(dailyLedger({ ...fixture, entries: [restored] }, "2026-11"), "2026-11-10").bills_cents, 10000);
});

test("a cross-month move keeps November's original total and places only its remaining cash forecast in December", () => {
  const fixture = data({
    entries: [entry("moved", { scheduled_date: "2026-12-02" })],
    payments: [payment("part", "moved", 3000, "2026-11-05")],
    months: [month("2026-11", 20000), month("2026-12", 17000)],
  });
  const november = monthSummary(fixture, "2026-11", "2026-11-15");
  const december = monthSummary(fixture, "2026-12", "2026-11-15");
  assert.equal(november.original_bills_cents, 10000);
  assert.equal(november.original_paid_cents, 3000);
  assert.equal(november.original_remaining_cents, 7000);
  assert.equal(november.scheduled_bills_cents, 3000);
  assert.equal(november.moved_out_cents, 7000);
  assert.equal(november.past_due_cents, 7000);
  assert.equal(december.original_bills_cents, 0);
  assert.equal(december.scheduled_bills_cents, 7000);
  assert.equal(december.moved_in_cents, 7000);
  assert.equal(december.ending_cents, 10000);
});

test("recurring occurrences remain independent when a month-end bill moves into the following month", () => {
  const fixture = data({
    today: "2027-02-10",
    entries: [
      entry("jan-occurrence", { series_id: "monthly", original_due_date: "2027-01-31", scheduled_date: "2027-02-05" }),
      entry("feb-occurrence", { series_id: "monthly", original_due_date: "2027-02-28" }),
      entry("mar-occurrence", { series_id: "monthly", original_due_date: "2027-03-31" }),
    ],
    payments: [payment("jan-paid-in-feb", "jan-occurrence", 10000, "2027-02-05")],
    months: [month("2027-01", 50000), month("2027-02", 50000), month("2027-03", 50000)],
    spending: [{ id: "feb-spend", user_id: "owner", date: "2027-02-20", amount_cents: 20000, title: "February only", created_at: timestamp }],
  });
  const january = monthSummary(fixture, "2027-01", fixture.today);
  const february = monthSummary(fixture, "2027-02", fixture.today);
  const march = monthSummary(fixture, "2027-03", fixture.today);
  assert.equal(january.original_bills_cents, 10000);
  assert.equal(january.original_paid_cents, 10000);
  assert.equal(january.scheduled_bills_cents, 0);
  assert.equal(february.original_bills_cents, 10000);
  assert.equal(february.original_paid_cents, 0);
  assert.equal(february.paid_bills_cents, 10000);
  assert.equal(february.scheduled_bills_cents, 20000);
  assert.equal(february.ending_cents, 30000);
  assert.equal(march.original_bills_cents, 10000);
  assert.equal(march.ending_cents, 40000);
  const drafts = [{ id: "feb-draft", kind: "bill", date: "2027-02-25", amount_cents: 5000 }];
  assert.equal(dailyLedger(fixture, "2027-02", { includeSpending: true, drafts }).at(-1).ending_cents, 5000);
  assert.equal(dailyLedger(fixture, "2027-03", { includeSpending: true, drafts }).at(-1).ending_cents, 40000);
  assert.equal(dailyLedger(fixture, "2027-02").at(-1).ending_cents, 30000);
});

test("partial payments replace the corresponding forecast and keep day entries unique", () => {
  const bill = entry("utility");
  const fixture = data({
    entries: [bill], payments: [payment("a", bill.id, 1000, "2026-11-02"), payment("b", bill.id, 2000, "2026-11-02")],
  });
  const ledger = dailyLedger(fixture, "2026-11");
  assert.equal(paidAmount(bill, fixture.payments), 3000);
  assert.equal(remainingAmount(bill, fixture.payments), 7000);
  assert.equal(on(ledger, "2026-11-02").bills_cents, 3000);
  assert.equal(on(ledger, "2026-11-02").entries.length, 1);
  assert.equal(on(ledger, "2026-11-10").bills_cents, 7000);
  assert.equal(ledger.reduce((total, day) => total + day.bills_cents, 0), 10000);
  assert.equal(entryState(bill, fixture.payments, "2026-11-05"), "partial");
  assert.equal(entryState(bill, fixture.payments, "2026-11-15"), "past_due");
});

test("a full payment uses its actual date, and reversing it restores the outstanding schedule", () => {
  const bill = entry("paid", { scheduled_date: "2026-11-20" });
  const actual = payment("payment", bill.id, 10000, "2026-11-12");
  const paidData = data({ entries: [bill], payments: [actual] });
  let ledger = dailyLedger(paidData, "2026-11");
  assert.equal(on(ledger, "2026-11-12").bills_cents, 10000);
  assert.equal(on(ledger, "2026-11-20").bills_cents, 0);
  assert.equal(entryState(bill, paidData.payments, "2026-11-15"), "paid");
  assert.equal(isPastDue(bill, paidData.payments, "2026-11-15"), false);
  const reversed = { ...paidData, payments: [{ ...actual, reversed_at: timestamp }] };
  ledger = dailyLedger(reversed, "2026-11");
  assert.equal(paidAmount(bill, reversed.payments), 0);
  assert.equal(on(ledger, "2026-11-12").bills_cents, 0);
  assert.equal(on(ledger, "2026-11-20").bills_cents, 10000);
  assert.equal(monthSummary(reversed, "2026-11", "2026-11-15").paid_bills_cents, 0);
});

test("income receipts and expected remainder are counted once and preserve cent precision", () => {
  const income = entry("paycheck", { kind: "income", amount_cents: 10029, original_due_date: "2026-11-15" });
  const fixture = data({ entries: [income], payments: [payment("received", income.id, 10000, "2026-11-01")] });
  const ledger = dailyLedger(fixture, "2026-11");
  assert.equal(on(ledger, "2026-11-01").income_cents, 10000);
  assert.equal(on(ledger, "2026-11-15").income_cents, 29);
  assert.equal(ledger.at(-1).ending_cents, 10029);
  const summary = monthSummary(fixture, "2026-11", "2026-11-05");
  assert.equal(summary.income_cents, 10029);
  assert.equal(summary.received_income_cents, 10000);
  assert.equal(summary.expected_income_cents, 29);
  assert.equal(summary.original_bills_cents, 0);
  assert.equal(entryState(income, [...fixture.payments, payment("last", income.id, 29, "2026-11-15")], "2026-11-20"), "received");
});

test("cancelled and transferred forecasts stop, while archived and inactive actual cash history remains", () => {
  const entries = [
    entry("cancelled", { status: "cancelled" }),
    entry("collections", { status: "collections" }),
    entry("archived", { archived_at: timestamp }),
  ];
  const fixture = data({
    entries,
    payments: [payment("a", "cancelled", 1000, "2026-11-01"), payment("b", "collections", 2000, "2026-11-02"), payment("c", "archived", 3000, "2026-11-03")],
  });
  const ledger = dailyLedger(fixture, "2026-11");
  assert.equal(on(ledger, "2026-11-10").bills_cents, 7000);
  assert.equal(ledger.at(-1).ending_cents, -13000);
  assert.equal(on(ledger, "2026-11-01").entries[0].status, "cancelled");
  const summary = monthSummary(fixture, "2026-11", "2026-11-15");
  assert.equal(summary.paid_bills_cents, 6000);
  assert.equal(summary.scheduled_bills_cents, 13000);
  assert.equal(summary.original_bills_cents, 30000);
  assert.equal(summary.original_cancelled_cents, 10000);
  assert.equal(summary.original_collections_cents, 10000);
  assert.equal(summary.original_payable_cents, 10000);
  assert.equal(summary.original_paid_cents, 3000);
  assert.equal(summary.original_progress_percent, 30);
  assert.equal(entryState(entries[0], fixture.payments, fixture.today), "cancelled");
  assert.equal(entryState(entries[1], fixture.payments, fixture.today), "collections");
});

test("original obligations survive amount edits while monthly progress uses current active amounts", () => {
  const fixture = data({
    entries: [
      entry("updated", { amount_cents: 15000, original_amount_cents: 10000 }),
      entry("inactive", { amount_cents: 20000, status: "cancelled" }),
    ],
    payments: [payment("active", "updated", 3000, "2026-11-01"), payment("cancelled", "inactive", 10000, "2026-11-01")],
  });
  const summary = monthSummary(fixture, "2026-11", "2026-11-15");
  assert.equal(summary.original_bills_cents, 30000);
  assert.equal(summary.original_payable_cents, 15000);
  assert.equal(summary.original_paid_cents, 3000);
  assert.equal(summary.original_remaining_cents, 12000);
  assert.equal(summary.original_progress_percent, 20);
  assert.equal(summary.paid_bills_cents, 13000);
});

test("Live Money spending and drafts affect later scenario balances without changing the baseline or source records", () => {
  const fixture = data({
    entries: [entry("bill")], months: [month("2026-11", 50000)],
    spending: [
      { id: "spend", user_id: "owner", date: "2026-11-12", amount_cents: 20000, title: "What if?", created_at: timestamp },
      { id: "other-month", user_id: "owner", date: "2026-12-12", amount_cents: 50000, title: "Future", created_at: timestamp },
    ],
  });
  const before = structuredClone(fixture);
  const drafts = [
    { id: "draft-income", kind: "income", date: "2026-11-15", amount_cents: 1000 },
    { id: "draft-bill", kind: "bill", date: "2026-11-16", amount_cents: 500 },
    { id: "draft-spend", kind: "spending", date: "2026-11-17", amount_cents: 200 },
  ];
  const baseline = dailyLedger(fixture, "2026-11");
  const scenario = dailyLedger(fixture, "2026-11", { includeSpending: true, drafts });
  assert.equal(baseline.at(-1).ending_cents, 40000);
  assert.equal(on(scenario, "2026-11-11").ending_cents, on(baseline, "2026-11-11").ending_cents);
  assert.equal(on(scenario, "2026-11-12").ending_cents, on(baseline, "2026-11-12").ending_cents - 20000);
  assert.equal(on(scenario, "2026-11-12").bills_cents, 0);
  assert.equal(on(scenario, "2026-11-12").spending_cents, 20000);
  assert.equal(scenario.at(-1).ending_cents, 20300);
  assert.equal(dailyLedger(fixture, "2026-11", { includeSpending: false, drafts }).at(-1).ending_cents, 40500);
  assert.equal(monthSummary(fixture, "2026-11", fixture.today).ending_cents, 40000);
  assert.deepEqual(fixture, before);
});

test("committing a bill draft and removing the successful draft preserves the scenario total exactly once", () => {
  const fixture = data({ months: [month("2026-11", 50000)] });
  const draft = { id: "commit", kind: "bill", date: "2026-11-20", amount_cents: 20000 };
  const trial = dailyLedger(fixture, "2026-11", { drafts: [draft] });
  const committed = { ...fixture, entries: [entry(draft.id, { amount_cents: draft.amount_cents, original_due_date: draft.date })] };
  const after = dailyLedger(committed, "2026-11", { drafts: [] });
  assert.equal(trial.at(-1).ending_cents, 30000);
  assert.equal(after.at(-1).ending_cents, trial.at(-1).ending_cents);
  assert.equal(monthSummary(committed, "2026-11", fixture.today).original_bills_cents, 20000);
});

test("older overdue bills remain visible without being silently imported into a month's cash forecast", () => {
  const fixture = data({
    entries: [
      entry("unscheduled", { amount_cents: 5000, original_due_date: "2026-10-15" }),
      entry("moved-in", { amount_cents: 8000, original_due_date: "2026-10-20", scheduled_date: "2026-11-18" }),
    ],
    months: [month("2026-11", 50000)],
  });
  const summary = monthSummary(fixture, "2026-11", "2026-11-15");
  assert.equal(summary.past_due_cents, 13000);
  assert.equal(summary.past_due_before_month_cents, 13000);
  assert.equal(summary.unscheduled_past_due_cents, 5000);
  assert.equal(summary.scheduled_bills_cents, 8000);
  assert.equal(summary.original_bills_cents, 0);
  assert.equal(summary.moved_in_cents, 8000);
  assert.equal(summary.ending_cents, 42000);
  assert.equal(summary.next_bill.id, "moved-in");
  assert.equal(summary.upcoming_bills_cents, 8000);
});

test("plan progress uses opening payments and the payment ledger, retaining late and transferred history", () => {
  const agreement = plan("agreement");
  const fixture = data({
    plans: [agreement],
    entries: [
      entry("first", { plan_id: agreement.id, expense_type: "installment", scheduled_date: "2026-11-20" }),
      entry("second", { plan_id: agreement.id, expense_type: "installment", original_due_date: "2026-12-10" }),
    ],
    payments: [payment("partial", "first", 5000, "2026-11-11"), payment("reversed", "first", 1000, "2026-11-12", { reversed_at: timestamp })],
  });
  const progress = planProgress(agreement, fixture);
  assert.equal(progress.paid_cents, 15000);
  assert.equal(progress.remaining_cents, 15000);
  assert.equal(progress.active_remaining_cents, 15000);
  assert.equal(progress.cancelled_remaining_cents, 0);
  assert.equal(progress.collections_remaining_cents, 0);
  assert.equal(progress.percent, 50);
  assert.equal(progress.past_due_cents, 5000);
  assert.equal(progress.next_entry.id, "first");
  assert.equal(monthSummary(fixture, "2026-11", fixture.today).installments_remaining_cents, 15000);
  const transferredPlan = { ...agreement, status: "collections" };
  const transferred = { ...fixture, plans: [transferredPlan], entries: fixture.entries.map((item) => ({ ...item, status: "collections" })) };
  assert.deepEqual(planProgress(transferredPlan, transferred), { paid_cents: 15000, remaining_cents: 15000, active_remaining_cents: 0, cancelled_remaining_cents: 0, collections_remaining_cents: 15000, percent: 50, past_due_cents: 0, next_entry: null });
  assert.equal(monthSummary(transferred, "2026-11", fixture.today).installments_remaining_cents, 0);
  assert.equal(monthSummary(transferred, "2026-11", fixture.today).paid_bills_cents, 5000);
});

test("standalone installment expenses add to plan remaining without double counting linked children", () => {
  const agreement = plan("agreement");
  const fixture = data({
    plans: [agreement],
    entries: [
      entry("first", { plan_id: agreement.id, expense_type: "installment" }),
      entry("second", { plan_id: agreement.id, expense_type: "installment", original_due_date: "2026-12-10" }),
      entry("standalone", { expense_type: "payment_plan", amount_cents: 7500 }),
      entry("cancelled", { expense_type: "payment_plan", amount_cents: 9000, status: "cancelled" }),
    ],
    payments: [payment("part", "first", 5000, "2026-11-11")],
  });
  assert.equal(monthSummary(fixture, "2026-11", fixture.today).installments_remaining_cents, 22500);
});

test("partial plan transfers and cancellations leave active totals without counting transferred debt twice", () => {
  const agreement = plan("mixed", { total_amount_cents: 50000 });
  const fixture = data({
    plans: [agreement],
    entries: [
      entry("active", { plan_id: agreement.id, expense_type: "installment", scheduled_date: "2026-11-20" }),
      entry("archived-active", { plan_id: agreement.id, expense_type: "installment", original_due_date: "2026-12-10", archived_at: timestamp }),
      entry("cancelled", { plan_id: agreement.id, expense_type: "installment", original_due_date: "2027-01-10", status: "cancelled" }),
      entry("transferred", { plan_id: agreement.id, expense_type: "installment", original_due_date: "2027-02-10", status: "collections" }),
      entry("standalone", { expense_type: "payment_plan", amount_cents: 7500 }),
    ],
    payments: [payment("active-part", "active", 2000, "2026-11-11"), payment("before-transfer", "transferred", 3000, "2026-11-12")],
    debts: [debt("transferred-debt", { current_balance_cents: 7000, source_entry_id: "transferred" })],
  });
  const progress = planProgress(agreement, fixture);
  assert.equal(progress.paid_cents, 15000);
  assert.equal(progress.percent, 30);
  assert.equal(progress.remaining_cents, 35000);
  assert.equal(progress.active_remaining_cents, 18000);
  assert.equal(progress.cancelled_remaining_cents, 10000);
  assert.equal(progress.collections_remaining_cents, 7000);
  assert.equal(progress.remaining_cents, progress.active_remaining_cents + progress.cancelled_remaining_cents + progress.collections_remaining_cents);
  assert.equal(progress.next_entry.id, "active");
  assert.equal(progress.past_due_cents, 8000);
  assert.equal(monthSummary(fixture, "2026-11", fixture.today).installments_remaining_cents, 25500);
  assert.equal(debtSummary(fixture, fixture.today).collections_cents, 7000);
  assert.equal(monthSummary(fixture, "2026-11", fixture.today).paid_bills_cents, 5000);
});

test("cancelling a plan does not count unpaid installments as paid or as an active schedule", () => {
  const agreement = plan("cancelled-plan", { status: "cancelled" });
  const fixture = data({
    plans: [agreement],
    entries: [entry("cancelled-first", { plan_id: agreement.id, expense_type: "installment", status: "cancelled" }), entry("cancelled-second", { plan_id: agreement.id, expense_type: "installment", status: "cancelled", original_due_date: "2026-12-10" })],
    payments: [payment("before-cancel", "cancelled-first", 5000, "2026-11-11")],
  });
  const progress = planProgress(agreement, fixture);
  assert.equal(progress.paid_cents, 15000);
  assert.equal(progress.percent, 50);
  assert.equal(progress.remaining_cents, 15000);
  assert.equal(progress.active_remaining_cents, 0);
  assert.equal(progress.cancelled_remaining_cents, 15000);
  assert.equal(progress.collections_remaining_cents, 0);
  assert.equal(progress.next_entry, null);
  assert.equal(progress.past_due_cents, 0);
  assert.equal(monthSummary(fixture, "2026-11", fixture.today).installments_remaining_cents, 0);
});

test("debt summaries keep charged-off/closed balances and treat unexpired offers as hypothetical", () => {
  const fixture = data({ debts: [
    debt("offer", { settlement_offer_cents: 6000, offer_monthly_cents: 500, offer_expires_on: "2026-11-15" }),
    debt("expired", { current_balance_cents: 8000, settlement_offer_cents: 4000, offer_monthly_cents: 200, offer_expires_on: "2026-11-14", status: "charged_off" }),
    debt("closed", { stage: "credit_report", current_balance_cents: 5000, settlement_offer_cents: 9000, offer_monthly_cents: 100, status: "closed", date_removed: "2026-11-01" }),
    debt("paid", { current_balance_cents: 0, status: "paid", offer_monthly_cents: 999 }),
    debt("forgiveness-offer", { current_balance_cents: 2000, settlement_offer_cents: 0 }),
  ] });
  assert.deepEqual(debtSummary(fixture, "2026-11-15"), { balance_cents: 25000, settlement_cents: 19000, monthly_offers_cents: 600, collections_cents: 20000 });
  assert.equal(monthSummary(fixture, "2026-11", fixture.today).scheduled_bills_cents, 0);
  assert.equal(dailyLedger(fixture, "2026-11").at(-1).ending_cents, 0);
});

test("transferring outstanding debt to collections retains payments but does not duplicate cash outflow", () => {
  const source = entry("source", { status: "collections" });
  const fixture = data({
    entries: [source], payments: [payment("paid", source.id, 4000, "2026-11-02")],
    debts: [debt("collection", { current_balance_cents: 6000, original_balance_cents: 6000, source_entry_id: source.id, offer_monthly_cents: 1000 })],
    months: [month("2026-11", 10000)],
  });
  assert.equal(monthSummary(fixture, "2026-11", fixture.today).ending_cents, 6000);
  assert.equal(monthSummary(fixture, "2026-11", fixture.today).scheduled_bills_cents, 4000);
  assert.equal(monthSummary(fixture, "2026-11", fixture.today).original_bills_cents, 10000);
  assert.equal(monthSummary(fixture, "2026-11", fixture.today).past_due_cents, 0);
  assert.equal(debtSummary(fixture, fixture.today).balance_cents, 6000);
});

test("upcoming totals cross year and leap-month boundaries in a seven-calendar-day window", () => {
  const yearEnd = data({
    entries: [
      entry("in-window", { original_due_date: "2027-01-04", amount_cents: 7000 }),
      entry("outside", { original_due_date: "2027-01-05", amount_cents: 9000 }),
      entry("income", { kind: "income", original_due_date: "2027-01-01", amount_cents: 30000 }),
    ],
  });
  const summary = monthSummary(yearEnd, "2026-12", "2026-12-29");
  assert.equal(summary.upcoming_bills_cents, 7000);
  assert.equal(summary.upcoming_income_cents, 30000);
  assert.equal(summary.next_bill.id, "in-window");
  assert.equal(summary.next_income.id, "income");
  const leap = data({ entries: [entry("last", { original_due_date: "2028-03-04", amount_cents: 100 }), entry("after", { original_due_date: "2028-03-05", amount_cents: 200 })] });
  assert.equal(monthSummary(leap, "2028-02", "2028-02-27").upcoming_bills_cents, 100);
});

test("lowest daily closing balance records the first low point and keeps income and bills separate", () => {
  const fixture = data({
    entries: [
      entry("bill", { amount_cents: 12000, original_due_date: "2026-11-05" }),
      entry("income", { kind: "income", amount_cents: 20000, original_due_date: "2026-11-20" }),
    ],
    months: [month("2026-11", 10000)],
  });
  const summary = monthSummary(fixture, "2026-11", "2026-11-15");
  assert.equal(summary.lowest_cents, -2000);
  assert.equal(summary.lowest_date, "2026-11-05");
  assert.equal(summary.net_cents, 8000);
  assert.equal(summary.ending_cents, 18000);
});
