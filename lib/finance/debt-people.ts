import { debtSummary } from "./calculations.ts";
import type { FinanceDebtSummary } from "./calculations";
import type { FinanceData, FinanceDebt } from "./types";

export interface DebtPersonOption {
  value: string;
  label: string;
  count: number;
}

const invalidNameCharacters = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const personPrefix = "person:";

function comparisonKey(name: string): string {
  // Match the SQL helper: retain dotted-I's mark and equate both Greek sigmas.
  return name.toLocaleLowerCase("en-US").replace(/\u03c2/gu, "\u03c3");
}

/** Null or a missing field represents an older, unassigned record. */
export function normalizeResponsiblePeople(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("Responsible people must be a list of names.");
  const names: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== "string") throw new Error("Each responsible person must have a name.");
    if (invalidNameCharacters.test(raw)) throw new Error("Names cannot include control characters or line breaks.");
    const name = raw.trim().replace(/\s+/gu, " ");
    if (!name) throw new Error("Enter a name for each responsible person, or remove the empty name.");
    if (Array.from(name).length > 100) throw new Error("Each person's name must be 100 characters or fewer.");
    const key = comparisonKey(name);
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
    if (names.length > 20) throw new Error("A debt can have up to 20 responsible people.");
  }
  return names;
}

/** Prefixes keep real names such as “All” or “Unassigned” distinct from filter controls. */
export function debtPersonKey(name: string): string {
  return personPrefix + comparisonKey(normalizeResponsiblePeople([name])[0]);
}

function peopleForDebt(debt: FinanceDebt): string[] {
  // Legacy snapshots have no field. Invalid cached data must not crash the debt view.
  try { return normalizeResponsiblePeople(debt.responsible_people); }
  catch { return []; }
}

function ownedDebts(data: FinanceData): FinanceDebt[] {
  const seen = new Set<string>();
  return data.debts.filter((debt) => {
    if (debt.user_id !== data.user.id || seen.has(debt.id)) return false;
    seen.add(debt.id);
    return true;
  });
}

/** Counts debt records, not people or shares of a debt's balance. */
export function debtPeopleOptions(data: FinanceData): DebtPersonOption[] {
  const debts = ownedDebts(data);
  const people = new Map<string, DebtPersonOption>();
  let unassigned = 0;
  for (const debt of debts) {
    const names = peopleForDebt(debt);
    if (names.length === 0) unassigned += 1;
    for (const name of names) {
      const value = debtPersonKey(name);
      const existing = people.get(value);
      if (existing) existing.count += 1;
      else people.set(value, { value, label: name, count: 1 });
    }
  }
  return [
    { value: "all", label: "All people", count: debts.length },
    { value: "unassigned", label: "Unassigned debts", count: unassigned },
    ...Array.from(people.values()).sort((a, b) => a.label.localeCompare(b.label, "en-US", { sensitivity: "base" }) || a.value.localeCompare(b.value, "en-US")),
  ];
}

/** A shared debt appears once in every matching person's view and once in All. */
export function filterDebtsByPerson(data: FinanceData, filter = "all"): FinanceDebt[] {
  const debts = ownedDebts(data);
  if (filter === "all") return debts;
  if (filter === "unassigned") return debts.filter((debt) => peopleForDebt(debt).length === 0);
  if (typeof filter !== "string" || !filter.startsWith(personPrefix)) return [];
  let key: string;
  try { key = debtPersonKey(filter.slice(personPrefix.length)); }
  catch { return []; }
  return debts.filter((debt) => peopleForDebt(debt).some((name) => debtPersonKey(name) === key));
}

export function debtSummaryForPerson(data: FinanceData, filter = "all", today = data.today): FinanceDebtSummary {
  return debtSummary({ ...data, debts: filterDebtsByPerson(data, filter) }, today);
}
