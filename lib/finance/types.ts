export type EntryKind = "bill" | "income";
export type ExpenseType = "bill" | "installment" | "payment_plan";
export type Frequency = "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly" | "custom";
export type CustomRepeatMode = "month_days" | "specific_dates";
export type FinanceAccountKind = "checking" | "savings" | "cash" | "credit_card";
export type FinanceAccountScope = "all" | string | null;
export type FinanceTagScope = "all" | "untagged" | string;
export type PaymentMethod = "manual" | "autopay" | "direct_deposit" | "bank_transfer" | "debit_card" | "credit_card" | "cash" | "check" | "card_refund" | "other";
export type FinanceMilestone = 25 | 50 | 75 | 100;
export interface FinanceEntry {
  id: string; user_id: string; kind: EntryKind; title: string; category: string;
  expense_type: ExpenseType; amount_cents: number; original_amount_cents: number;
  original_due_date: string; scheduled_date: string;
  status: "active" | "cancelled" | "collections"; archived_at: string | null;
  series_id: string | null; plan_id: string | null; vendor_id: string | null; notes: string;
  tag_ids: string[];
  account_id: string | null; payment_method: PaymentMethod; reminder_days: number | null; reminder_snoozed_until: string | null;
  created_at: string; updated_at: string;
}
export interface FinancePayment {
  id: string; user_id: string; entry_id: string; amount_cents: number;
  paid_on: string; note: string; reversed_at: string | null; created_at: string;
  account_id: string | null; payment_method: PaymentMethod;
}
export interface FinanceSeries {
  id: string; user_id: string; kind: EntryKind; title: string; category: string;
  expense_type: ExpenseType; amount_cents: number; start_date: string;
  end_date: string | null; frequency: Frequency; active: boolean; notes: string;
  custom_mode: CustomRepeatMode | null; custom_month_days: number[]; custom_dates: string[];
  vendor_id: string | null;
  tag_ids: string[];
  account_id: string | null; payment_method: PaymentMethod; reminder_days: number | null;
  created_at: string;
}
export interface FinancePlan {
  id: string; user_id: string; title: string; creditor: string;
  kind: "installment" | "payment_plan"; category: string;
  total_amount_cents: number; opening_paid_cents: number; installment_amount_cents: number;
  frequency: "weekly" | "biweekly" | "monthly" | "quarterly"; first_due_date: string;
  status: "active" | "cancelled" | "collections"; vendor_id: string | null; notes: string; created_at: string;
  tag_ids: string[];
  account_id: string | null; payment_method: PaymentMethod; reminder_days: number | null;
}
export interface FinanceAccount {
  id: string; user_id: string; name: string; institution: string; kind: FinanceAccountKind;
  last_four: string | null; opening_date: string; opening_balance_cents: number; credit_limit_cents: number | null;
  notes: string; archived_at: string | null; created_at: string; updated_at: string;
}
export interface FinanceBalanceUpdate {
  id: string; user_id: string; account_id: string | null; date: string; balance_cents: number;
  notes: string; created_at: string; updated_at: string;
}
export interface FinanceTransfer {
  id: string; user_id: string; from_account_id: string; to_account_id: string;
  amount_cents: number; date: string; status: "planned" | "completed" | "cancelled";
  notes: string; created_at: string; updated_at: string;
}
export interface FinanceGoal {
  id: string; user_id: string; account_id: string; title: string; target_cents: number; allocated_cents: number;
  start_date: string; target_date: string | null; notes: string; archived_at: string | null;
  achieved_milestones: FinanceMilestone[]; created_at: string; updated_at: string;
}
export interface FinanceGoalHistory {
  id: string; user_id: string; goal_id: string; previous_allocated_cents: number | null;
  allocated_cents: number; note: string; created_at: string;
}
export interface FinanceVendor {
  id: string; user_id: string; name: string; url: string | null; notes: string;
  archived_at: string | null; created_at: string; updated_at: string;
}
export interface FinanceTag {
  id: string; user_id: string; name: string; archived_at: string | null; created_at: string; updated_at: string;
}
export interface FinanceDebt {
  id: string; user_id: string; title: string; stage: "credit_report" | "collections";
  original_creditor: string; collector: string; original_balance_cents: number;
  current_balance_cents: number; status: "open" | "charged_off" | "closed" | "paid";
  date_added: string; date_removed: string | null; settlement_offer_cents: number | null;
  offer_monthly_cents: number | null; offer_expires_on: string | null;
  source_entry_id: string | null; source_plan_id: string | null;
  responsible_people: string[];
  notes: string; created_at: string; updated_at: string;
}
export interface FinanceDebtHistory {
  id: string; user_id: string; debt_id: string; previous_balance_cents: number | null;
  balance_cents: number; note: string; created_at: string;
  details?: { previous_responsible_people?: string[] | null; responsible_people?: string[]; [key: string]: unknown };
}
export interface FinanceSpending {
  id: string; user_id: string; date: string; title: string; amount_cents: number; created_at: string;
  account_id: string | null;
}
export interface FinanceMonth {
  user_id: string; month: string; opening_balance_cents: number; updated_at: string;
}
export interface FinanceData {
  user: { id: string; display_name: string }; today: string;
  entries: FinanceEntry[]; payments: FinancePayment[]; series: FinanceSeries[];
  plans: FinancePlan[]; debts: FinanceDebt[]; debt_history: FinanceDebtHistory[];
  spending: FinanceSpending[]; months: FinanceMonth[]; vendors: FinanceVendor[]; tags: FinanceTag[];
  accounts: FinanceAccount[]; balance_updates: FinanceBalanceUpdate[]; transfers: FinanceTransfer[];
  goals: FinanceGoal[]; goal_history: FinanceGoalHistory[];
}
export interface FinanceMutationResult { id?: string | null; milestones?: FinanceMilestone[]; replayed?: boolean; }
export type FinanceMutate = (action: string, payload: Record<string, unknown>) => Promise<void>;
export interface RecordsProps {
  data: FinanceData; month: string; today: string; mutate: FinanceMutate;
  openEntry: (entry?: FinanceEntry, kind?: EntryKind, date?: string) => void;
  openPlan: (plan?: FinancePlan) => void; openDebt: (debt?: FinanceDebt) => void;
  openPayment: (entry: FinanceEntry) => void; openMove: (entry: FinanceEntry) => void;
  notify: (message: string) => void;
  accountScope?: FinanceAccountScope;
  tagScope?: FinanceTagScope;
  openBalance?: (date: string, accountId?: string | null) => void;
  openAccount?: (kind?: FinanceAccountKind, account?: FinanceAccount) => void;
  openTransfer?: (date?: string) => void;
}
export const FINANCE_CATEGORIES = ["Home", "Car & transport", "Utilities", "Subscriptions", "Insurance", "Health", "Family", "Education", "Debt payments", "Other"] as const;
export const INCOME_CATEGORIES = ["Paycheck", "Self-employment", "Benefits", "Refund", "Other"] as const;
export const FREQUENCY_LABELS: Record<Frequency | "once", string> = { once: "One time", weekly: "Weekly", biweekly: "Every 2 weeks", monthly: "Monthly", quarterly: "Quarterly", yearly: "Yearly", custom: "Custom dates" };
export const ACCOUNT_KIND_LABELS: Record<FinanceAccountKind, string> = { checking: "Checking", savings: "Savings", cash: "Cash", credit_card: "Credit card" };
export const BILL_PAYMENT_METHODS = ["manual", "autopay", "bank_transfer", "debit_card", "credit_card", "cash", "check", "other"] as const;
export const INCOME_PAYMENT_METHODS = ["manual", "direct_deposit", "bank_transfer", "cash", "check", "card_refund", "other"] as const;
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = { manual: "Manual", autopay: "Autopay", direct_deposit: "Direct deposit", bank_transfer: "Bank transfer", debit_card: "Debit card", credit_card: "Credit card", cash: "Cash", check: "Check", card_refund: "Card refund", other: "Other" };
