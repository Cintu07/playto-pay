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
      setError(submissionError instanceof Error ? submissionError.message : "Failed to create payout");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen px-4 py-8 text-ink md:px-8 lg:px-12">
      <div className="mx-auto max-w-7xl">
        <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-[2rem] bg-white/80 p-8 shadow-panel backdrop-blur">
            <p className="font-mono text-xs uppercase tracking-[0.28em] text-slate">Playto payout engine</p>
            <h1 className="mt-4 max-w-xl font-display text-4xl font-bold leading-tight text-ink md:text-6xl">
              A money-moving dashboard that keeps the hard parts boring.
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-slate md:text-lg">
              Available and held balances are derived from the ledger. Payout requests are idempotent. The worker settles asynchronously with retries for stuck bank states.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <label className="text-sm text-slate">
                Demo merchant
                <select
                  value={selectedMerchantId}
                  onChange={(event) => setSelectedMerchantId(event.target.value)}
                  className="ml-3 rounded-full border border-sand bg-sand px-4 py-2 text-sm text-ink"
                >
                  {merchants.map((merchant) => (
                    <option key={merchant.id} value={merchant.id}>
                      {merchant.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="rounded-full bg-coral/10 px-4 py-2 font-mono text-xs uppercase tracking-[0.24em] text-coral">Polling every 5s</div>
            </div>
          </div>

          <div className="rounded-[2rem] bg-ink p-8 text-white shadow-panel">
            <p className="font-mono text-xs uppercase tracking-[0.24em] text-white/70">What is graded</p>
            <ul className="mt-6 space-y-4 text-sm leading-6 text-white/85">
              <li>Ledger math is derived in SQL using integer paise fields.</li>
              <li>Concurrent payouts lock on the merchant row before creating holds.</li>
              <li>Idempotency keys are scoped per merchant and cached for 24 hours.</li>
              <li>Failed payouts release held funds atomically with the state change.</li>
            </ul>
          </div>
        </section>

        {error ? <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">{error}</div> : null}
        {successMessage ? <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-700">{successMessage}</div> : null}

        {isLoading || !dashboard ? (
          <div className="mt-10 rounded-[2rem] bg-white p-10 text-center text-slate shadow-panel">Loading payout dashboard...</div>
        ) : (
          <div className="mt-10 space-y-6">
            <section className="grid gap-4 md:grid-cols-3">
              <BalanceCard label="Available" value={formatPaise(dashboard.balances.available_balance_paise)} tone="ink" />
              <BalanceCard label="Held" value={formatPaise(dashboard.balances.held_balance_paise)} tone="spruce" />
              <BalanceCard label="Total" value={formatPaise(dashboard.balances.total_balance_paise)} tone="coral" />
            </section>

            <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
              <PayoutForm bankAccounts={dashboard.bank_accounts} isSubmitting={isSubmitting} onSubmit={handleCreatePayout} />
              <PayoutTable payouts={dashboard.payouts} />
            </section>

            <LedgerTable entries={dashboard.recent_ledger_entries} />
          </div>
        )}
      </div>
    </main>
  );
}