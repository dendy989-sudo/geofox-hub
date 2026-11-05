export type EntryKind = "bill" | "income";
export type ExpenseType = "bill" | "installment" | "payment_plan";
export type Frequency = "weekly" | "biweekly" | "monthly" | "yearly" | "custom";
export type CustomRepeatMode = "month_days" | "specific_dates";
export interface FinanceEntry {
  id: string; user_id: string; kind: EntryKind; title: string; category: string;
  expense_type: ExpenseType; amount_cents: number; original_amount_cents: number;
  original_due_date: string; scheduled_date: string;
  status: "active" | "cancelled" | "collections"; archived_at: string | null;
  series_id: string | null; plan_id: string | null; vendor_id: string | null; notes: string;
  created_at: string; updated_at: string;
}
export interface FinancePayment {
  id: string; user_id: string; entry_id: string; amount_cents: number;
  paid_on: string; note: string; reversed_at: string | null; created_at: string;
}
export interface FinanceSeries {
  id: string; user_id: string; kind: EntryKind; title: string; category: string;
  expense_type: ExpenseType; amount_cents: number; start_date: string;
  end_date: string | null; frequency: Frequency; active: boolean; notes: string;
  custom_mode: CustomRepeatMode | null; custom_month_days: number[]; custom_dates: string[];
  vendor_id: string | null;
  created_at: string;
}
export interface FinancePlan {
  id: string; user_id: string; title: string; creditor: string;
  kind: "installment" | "payment_plan"; category: string;
  total_amount_cents: number; opening_paid_cents: number; installment_amount_cents: number;
  frequency: "weekly" | "biweekly" | "monthly"; first_due_date: string;
  status: "active" | "cancelled" | "collections"; vendor_id: string | null; notes: string; created_at: string;
}
export interface FinanceVendor {
  id: string; user_id: string; name: string; url: string | null; notes: string;
  archived_at: string | null; created_at: string; updated_at: string;
}
export interface FinanceDebt {
  id: string; user_id: string; title: string; stage: "credit_report" | "collections";
  original_creditor: string; collector: string; original_balance_cents: number;
  current_balance_cents: number; status: "open" | "charged_off" | "closed" | "paid";
  date_added: string; date_removed: string | null; settlement_offer_cents: number | null;
  offer_monthly_cents: number | null; offer_expires_on: string | null;
  source_entry_id: string | null; source_plan_id: string | null;
  notes: string; created_at: string; updated_at: string;
}
export interface FinanceDebtHistory {
  id: string; user_id: string; debt_id: string; previous_balance_cents: number | null;
  balance_cents: number; note: string; created_at: string;
}
export interface FinanceSpending {
  id: string; user_id: string; date: string; title: string; amount_cents: number; created_at: string;
}
export interface FinanceMonth {
  user_id: string; month: string; opening_balance_cents: number; updated_at: string;
}
export interface FinanceData {
  user: { id: string; display_name: string }; today: string;
  entries: FinanceEntry[]; payments: FinancePayment[]; series: FinanceSeries[];
  plans: FinancePlan[]; debts: FinanceDebt[]; debt_history: FinanceDebtHistory[];
  spending: FinanceSpending[]; months: FinanceMonth[]; vendors: FinanceVendor[];
}
export type FinanceMutate = (action: string, payload: Record<string, unknown>) => Promise<void>;
export interface RecordsProps {
  data: FinanceData; month: string; today: string; mutate: FinanceMutate;
  openEntry: (entry?: FinanceEntry, kind?: EntryKind, date?: string) => void;
  openPlan: (plan?: FinancePlan) => void; openDebt: (debt?: FinanceDebt) => void;
  openPayment: (entry: FinanceEntry) => void; openMove: (entry: FinanceEntry) => void;
  notify: (message: string) => void;
}
export const FINANCE_CATEGORIES = ["Home", "Car & transport", "Utilities", "Subscriptions", "Insurance", "Health", "Family", "Education", "Debt payments", "Other"] as const;
export const INCOME_CATEGORIES = ["Paycheck", "Self-employment", "Benefits", "Refund", "Other"] as const;
export const FREQUENCY_LABELS: Record<Frequency | "once", string> = { once: "One time", weekly: "Weekly", biweekly: "Every 2 weeks", monthly: "Monthly", yearly: "Yearly", custom: "Custom dates" };
