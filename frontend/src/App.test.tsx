import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import type { DashboardPayload, Merchant, Payout } from "./lib/api";
import { fetchDashboard, listMerchants } from "./lib/api";

vi.mock("./lib/api", async () => {
  const actual = await vi.importActual<typeof import("./lib/api")>("./lib/api");

  return {
    ...actual,
    listMerchants: vi.fn(),
    fetchDashboard: vi.fn(),
    createPayout: vi.fn(),
  };
});

const mockedListMerchants = vi.mocked(listMerchants);
const mockedFetchDashboard = vi.mocked(fetchDashboard);

const merchants: Merchant[] = [
  {
    id: "merchant-1",
    name: "Blue Pine Creative",
    slug: "blue-pine-creative",
    email: "bluepine@example.com",
  },
];

const payout: Payout = {
  id: "payout-1",
  amount_paise: 30000,
  idempotency_key: "idem-1",
  status: "completed",
  attempt_count: 1,
  failure_reason: "",
  processing_started_at: null,
  next_retry_at: null,
  created_at: "2026-04-28T18:14:00.000Z",
  updated_at: "2026-04-28T18:15:00.000Z",
  bank_account: {
    id: "bank-1",
    label: "Primary",
    bank_name: "HDFC Bank",
    account_number: "****4321",
    ifsc_code: "HDFC0001234",
  },
};

const dashboard: DashboardPayload = {
  merchant: merchants[0],
  balances: {
    available_balance_paise: 105000,
    held_balance_paise: 0,
    total_balance_paise: 105000,
  },
  bank_accounts: [payout.bank_account],
  recent_ledger_entries: [
    {
      id: "ledger-1",
      entry_type: "debit",
      available_delta_paise: 0,
      held_delta_paise: -30000,
      reference: "seed-payout-1",
      description: "Seed payout completion",
      created_at: "2026-04-28T18:14:00.000Z",
    },
  ],
  payouts: [payout],
};

describe("App", () => {
  beforeEach(() => {
    mockedListMerchants.mockResolvedValue(merchants);
    mockedFetchDashboard.mockResolvedValue(dashboard);
    vi.spyOn(window, "setInterval").mockReturnValue(1 as unknown as ReturnType<typeof window.setInterval>);
    vi.spyOn(window, "clearInterval").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the payout panels in a stacked vertical section", async () => {
    const { container } = render(<App />);

    await screen.findByText("Request payout");
    await screen.findByText("Payout history");
    await screen.findByText("Ledger movement");

    const stackedSection = container.querySelector("section.flex.flex-col.gap-8");

    expect(stackedSection).not.toBeNull();

    const text = stackedSection?.textContent ?? "";
    expect(text.indexOf("Request payout")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("Request payout")).toBeLessThan(text.indexOf("Payout history"));
    expect(text.indexOf("Payout history")).toBeLessThan(text.indexOf("Ledger movement"));
  });
});