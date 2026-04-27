export type Merchant = {
  id: string;
  name: string;
  slug: string;
  email: string;
};

export type BankAccount = {
  id: string;
  label: string;
  bank_name: string;
  account_number: string;
  ifsc_code: string;
};

export type LedgerEntry = {
  id: string;
  entry_type: string;
  available_delta_paise: number;
  held_delta_paise: number;
  reference: string;
  description: string;
  created_at: string;
};

export type Payout = {
  id: string;
  amount_paise: number;
  idempotency_key: string;
  status: string;
  attempt_count: number;
  failure_reason: string;
  processing_started_at: string | null;
  next_retry_at: string | null;
  created_at: string;
  updated_at: string;
  bank_account: BankAccount;
};

export type DashboardPayload = {
  merchant: Merchant;
  balances: {
    available_balance_paise: number;
    held_balance_paise: number;
    total_balance_paise: number;
  };
  bank_accounts: BankAccount[];
  recent_ledger_entries: LedgerEntry[];
  payouts: Payout[];
};

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

function buildUrl(path: string): string {
  if (!API_BASE_URL) {
    return path;
  }
  return `${API_BASE_URL}${path}`;
}

type RequestOptions = {
  merchantId?: string;
  idempotencyKey?: string;
  method?: "GET" | "POST";
  body?: Record<string, unknown>;
};

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(buildUrl(path), {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.merchantId ? { "X-Merchant-Id": options.merchantId } : {}),
      ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.message || payload.detail || "Request failed");
  }
  return payload as T;
}

export function listMerchants(): Promise<Merchant[]> {
  return request<Merchant[]>("/api/v1/merchants");
}

export function fetchDashboard(merchantId: string): Promise<DashboardPayload> {
  return request<DashboardPayload>("/api/v1/dashboard", { merchantId });
}

export function createPayout(input: {
  merchantId: string;
  amountPaise: number;
  bankAccountId: string;
}) {
  return request<{ payout: Payout }>("/api/v1/payouts", {
    merchantId: input.merchantId,
    method: "POST",
    idempotencyKey: crypto.randomUUID(),
    body: {
      amount_paise: input.amountPaise,
      bank_account_id: input.bankAccountId,
    },
  });
}

export function formatPaise(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(amount / 100);
}

export function formatTimestamp(value: string | null): string {
  if (!value) {
    return "-";
  }
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}