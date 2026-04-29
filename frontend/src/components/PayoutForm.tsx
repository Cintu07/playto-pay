import { FormEvent, useEffect, useState } from "react";

import type { BankAccount } from "../lib/api";
import { formatPaise } from "../lib/api";

type PayoutFormProps = {
  bankAccounts: BankAccount[];
  availableBalancePaise: number;
  isSubmitting: boolean;
  submissionError: string;
  onSubmit: (input: { amountPaise: number; bankAccountId: string }) => Promise<void>;
};

export function PayoutForm({ bankAccounts, availableBalancePaise, isSubmitting, submissionError, onSubmit }: PayoutFormProps) {
  const [amountRupees, setAmountRupees] = useState("1");
  const [bankAccountId, setBankAccountId] = useState(bankAccounts[0]?.id || "");
  const maxPayoutRupees = Math.floor(availableBalancePaise / 100);

  useEffect(() => {
    if (!bankAccountId && bankAccounts[0]?.id) {
      setBankAccountId(bankAccounts[0].id);
    }
  }, [bankAccountId, bankAccounts]);

  useEffect(() => {
    const current = Number(amountRupees || "0");
    if (current > maxPayoutRupees) {
      setAmountRupees(String(maxPayoutRupees));
    }
  }, [amountRupees, maxPayoutRupees]);

  const normalizedAmount = Math.round(Number(amountRupees || "0") * 100);
  const hasFunds = availableBalancePaise > 0;
  const exceedsAvailable = normalizedAmount > availableBalancePaise;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!normalizedAmount || !bankAccountId || exceedsAvailable || !hasFunds) {
      return;
    }
    await onSubmit({ amountPaise: normalizedAmount, bankAccountId });
  }

  return (
    <form onSubmit={handleSubmit} className="self-start rounded-[2.25rem] bg-white p-6 shadow-panel md:p-7">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="font-display text-xl font-bold text-ink">Request payout</p>
          <p className="mt-1 text-sm text-slate">Funds are held immediately and settled by the background worker.</p>
        </div>
        <div className="rounded-full bg-sand px-4 py-2 font-mono text-[11px] uppercase tracking-[0.24em] text-slate">Async only</div>
      </div>

      <div className="mt-6 rounded-[1.6rem] border border-sand bg-sand/30 p-4">
        <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-slate">Payout preview</p>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-sm text-slate">This request moves funds to hold first, then the worker settles it.</p>
            <p className="mt-2 text-2xl font-bold text-ink">{formatPaise(normalizedAmount)}</p>
          </div>
          <div className="rounded-full bg-white px-4 py-2 font-mono text-[11px] uppercase tracking-[0.24em] text-slate">
            Bank transfer
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <label className="block text-sm text-slate">
          <span className="font-mono text-[11px] uppercase tracking-[0.24em]">Amount in INR</span>
          <input
            type="number"
            min="0"
            max={String(Math.max(0, maxPayoutRupees))}
            step="1"
            value={amountRupees}
            onChange={(event) => setAmountRupees(event.target.value)}
            className="mt-2 w-full rounded-2xl border border-sand bg-sand/70 px-4 py-3 text-base text-ink outline-none ring-0"
          />
        </label>

        <label className="block text-sm text-slate">
          <span className="font-mono text-[11px] uppercase tracking-[0.24em]">Bank account</span>
          <select
            value={bankAccountId}
            onChange={(event) => setBankAccountId(event.target.value)}
            className="mt-2 w-full rounded-2xl border border-sand bg-sand/70 px-4 py-3 text-base text-ink outline-none"
          >
            {bankAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.bank_name} · {account.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-4 rounded-2xl border border-dashed border-sand px-4 py-3 text-sm text-slate">
        Example: ₹{amountRupees || "0"} becomes {formatPaise(normalizedAmount)} in paise before the payout is processed.
      </div>

      <div className="mt-3 rounded-2xl border border-sand/80 bg-sand/35 px-4 py-3 text-sm text-slate">
        Max payout right now: <span className="font-semibold text-ink">{formatPaise(availableBalancePaise)}</span>
      </div>

      {!hasFunds ? (
        <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No available balance right now. Add funds first, then create a payout.
        </div>
      ) : null}

      {exceedsAvailable ? (
        <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          Requested amount is higher than available balance. Lower the amount and try again.
        </div>
      ) : null}

      {submissionError ? (
        <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {submissionError}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={isSubmitting || !bankAccounts.length || exceedsAvailable || !hasFunds || normalizedAmount < 100}
        className="mt-6 inline-flex w-full items-center justify-center rounded-full bg-ink px-5 py-3 text-sm font-medium text-white transition hover:translate-y-[-1px] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSubmitting ? "Submitting..." : "Create payout"}
      </button>
    </form>
  );
}