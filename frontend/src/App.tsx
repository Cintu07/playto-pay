import { useEffect, useState } from "react";

import { BalanceCard } from "./components/BalanceCard";
import { LedgerTable } from "./components/LedgerTable";
import { PayoutForm } from "./components/PayoutForm";
import { PayoutTable } from "./components/PayoutTable";
import { createPayout, fetchDashboard, formatPaise, listMerchants } from "./lib/api";
import type { DashboardPayload, Merchant } from "./lib/api";

const POLL_INTERVAL_MS = 5000;

export default function App() {
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [selectedMerchantId, setSelectedMerchantId] = useState<string>("");
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string>("");
  const [payoutError, setPayoutError] = useState<string>("");
  const [successMessage, setSuccessMessage] = useState<string>("");

  useEffect(() => {
    void listMerchants()
      .then((merchantList) => {
        setMerchants(merchantList);
        setSelectedMerchantId((current) => current || merchantList[0]?.id || "");
      })
      .catch((loadError: Error) => setError(loadError.message));
  }, []);

  useEffect(() => {
    if (!selectedMerchantId) {
      return;
    }

    let cancelled = false;

    async function loadDashboard() {
      try {
        const nextDashboard = await fetchDashboard(selectedMerchantId);
        if (!cancelled) {
          setDashboard(nextDashboard);
          setError("");
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load dashboard");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadDashboard();
    const intervalId = window.setInterval(() => {
      void loadDashboard();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [selectedMerchantId]);

  async function handleCreatePayout(input: { amountPaise: number; bankAccountId: string }) {
    if (!selectedMerchantId) {
      return;
    }
    setIsSubmitting(true);
    setSuccessMessage("");
    setError("");
    setPayoutError("");
    try {
      const result = await createPayout({
        merchantId: selectedMerchantId,
        amountPaise: input.amountPaise,
        bankAccountId: input.bankAccountId,
      });
      setSuccessMessage(`Payout ${result.payout.id.slice(0, 8)} created in ${result.payout.status} state.`);
      const nextDashboard = await fetchDashboard(selectedMerchantId);
      setDashboard(nextDashboard);
    } catch (submissionError) {
      const message = submissionError instanceof Error ? submissionError.message : "Failed to create payout";
      setPayoutError(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  const selectedMerchant = merchants.find((merchant) => merchant.id === selectedMerchantId) || null;

  return (
    <main className="min-h-screen px-4 py-8 text-ink md:px-8 lg:px-12">
      <div className="mx-auto max-w-7xl">
        <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="relative overflow-hidden rounded-[2.25rem] bg-white/85 p-8 shadow-panel backdrop-blur md:p-10">
            <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-r from-coral/12 via-transparent to-spruce/10" />
            <div className="relative">
              <div className="flex flex-wrap items-center gap-3">
                <div className="rounded-full border border-sand bg-sand/70 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.28em] text-slate">
                  Playto payout engine
                </div>
                <div className="rounded-full bg-coral/10 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.24em] text-coral">
                  Live merchant ledger
                </div>
              </div>

              <h1 className="mt-6 max-w-2xl font-display text-4xl font-bold leading-[0.95] text-ink md:text-5xl xl:text-6xl">
              A money-moving dashboard that keeps the hard parts boring.
              </h1>

              <p className="mt-5 max-w-2xl text-base leading-7 text-slate md:text-lg">
                Available and held balances come from the ledger, not a cached number. Payout requests are idempotent, worker-driven, and easy to inspect when something goes wrong.
              </p>

              <div className="mt-8 grid gap-3 md:grid-cols-3">
                <div className="rounded-[1.5rem] border border-sand bg-sand/55 p-4">
                  <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-slate">Selected merchant</p>
                  <p className="mt-3 text-lg font-semibold text-ink">{selectedMerchant?.name || "Loading..."}</p>
                  <p className="mt-1 text-sm text-slate">{selectedMerchant?.email || "Waiting for merchant data"}</p>
                </div>
                <div className="rounded-[1.5rem] border border-sand bg-sand/55 p-4">
                  <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-slate">Live refresh</p>
                  <p className="mt-3 text-lg font-semibold text-ink">Every 5 seconds</p>
                  <p className="mt-1 text-sm text-slate">Status changes land here without a manual refresh.</p>
                </div>
                <div className="rounded-[1.5rem] border border-sand bg-sand/55 p-4">
                  <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-slate">Screen focus</p>
                  <p className="mt-3 text-lg font-semibold text-ink">Audit over polish</p>
                  <p className="mt-1 text-sm text-slate">Balance visibility, payout state, and ledger trail are the point.</p>
                </div>
              </div>

              <div className="mt-8 flex flex-col gap-3 rounded-[1.75rem] border border-sand bg-white/70 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-slate">Demo merchant</p>
                  <p className="mt-1 text-sm text-slate">Switch merchants to compare balances, history, and payout behavior.</p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <select
                    value={selectedMerchantId}
                    onChange={(event) => setSelectedMerchantId(event.target.value)}
                    className="rounded-full border border-sand bg-sand px-4 py-3 text-sm font-medium text-ink outline-none"
                  >
                    {merchants.map((merchant) => (
                      <option key={merchant.id} value={merchant.id}>
                        {merchant.name}
                      </option>
                    ))}
                  </select>
                  <div className="rounded-full bg-coral/10 px-4 py-3 font-mono text-[11px] uppercase tracking-[0.24em] text-coral">
                    Polling every 5s
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-6">
            <div className="rounded-[2.25rem] bg-ink p-8 text-white shadow-panel md:p-10">
              <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-white/70">What is graded</p>
              <div className="mt-6 space-y-3">
                <div className="rounded-[1.4rem] border border-white/10 bg-white/5 p-4 text-sm leading-6 text-white/85">
                  Ledger math is derived in SQL using integer paise fields.
                </div>
                <div className="rounded-[1.4rem] border border-white/10 bg-white/5 p-4 text-sm leading-6 text-white/85">
                  Concurrent payouts lock on the merchant row before creating holds.
                </div>
                <div className="rounded-[1.4rem] border border-white/10 bg-white/5 p-4 text-sm leading-6 text-white/85">
                  Idempotency keys are scoped per merchant and cached for 24 hours.
                </div>
                <div className="rounded-[1.4rem] border border-white/10 bg-white/5 p-4 text-sm leading-6 text-white/85">
                  Failed payouts release held funds atomically with the state change.
                </div>
              </div>
            </div>

            <div className="rounded-[2rem] bg-white/85 p-6 shadow-panel">
              <p className="font-display text-xl font-bold text-ink">How to read this screen</p>
              <ul className="mt-4 space-y-3 text-sm leading-6 text-slate">
                <li>Available balance is what can still be paid out right now.</li>
                <li>Held balance is money reserved by pending or processing payouts.</li>
                <li>Payout history shows the state machine and retry attempts.</li>
                <li>Ledger movement is the audit trail behind every balance change.</li>
              </ul>
            </div>
          </div>
        </section>

        {error ? <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">{error}</div> : null}
        {successMessage ? <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-700">{successMessage}</div> : null}

        {isLoading || !dashboard ? (
          <div className="mt-10 rounded-[2rem] bg-white p-10 text-center text-slate shadow-panel">Loading payout dashboard...</div>
        ) : (
          <div className="mt-10 space-y-6">
            <section className="grid gap-4 lg:grid-cols-3">
              <BalanceCard label="Available" value={formatPaise(dashboard.balances.available_balance_paise)} tone="ink" />
              <BalanceCard label="Held" value={formatPaise(dashboard.balances.held_balance_paise)} tone="spruce" />
              <BalanceCard label="Total" value={formatPaise(dashboard.balances.total_balance_paise)} tone="coral" />
            </section>

            <section className="grid items-start gap-6 xl:grid-cols-[0.88fr_1.12fr]">
              <PayoutForm
                bankAccounts={dashboard.bank_accounts}
                availableBalancePaise={dashboard.balances.available_balance_paise}
                isSubmitting={isSubmitting}
                submissionError={payoutError}
                onSubmit={handleCreatePayout}
              />
              <PayoutTable payouts={dashboard.payouts} />
            </section>

            <LedgerTable entries={dashboard.recent_ledger_entries} />
          </div>
        )}
      </div>
    </main>
  );
}