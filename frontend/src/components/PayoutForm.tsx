import { FormEvent, useEffect, useState } from "react";

import type { BankAccount } from "../lib/api";
import { formatPaise } from "../lib/api";

type PayoutFormProps = {
  bankAccounts: BankAccount[];
  isSubmitting: boolean;
  onSubmit: (input: { amountPaise: number; bankAccountId: string }) => Promise<void>;
};

export function PayoutForm({ bankAccounts, isSubmitting, onSubmit }: PayoutFormProps) {
  const [amountRupees, setAmountRupees] = useState("500");
  const [bankAccountId, setBankAccountId] = useState(bankAccounts[0]?.id || "");

  useEffect(() => {
    if (!bankAccountId && bankAccounts[0]?.id) {
      setBankAccountId(bankAccounts[0].id);
    }
  }, [bankAccountId, bankAccounts]);

  const normalizedAmount = Math.round(Number(amountRupees || "0") * 100);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!normalizedAmount || !bankAccountId) {
      return;
    }
    await onSubmit({ amountPaise: normalizedAmount, bankAccountId });
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-[2.25rem] bg-white p-6 shadow-panel md:p-7">
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
            min="1"
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

      <button
        type="submit"
        disabled={isSubmitting || !bankAccounts.length}
        className="mt-6 inline-flex w-full items-center justify-center rounded-full bg-ink px-5 py-3 text-sm font-medium text-white transition hover:translate-y-[-1px] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSubmitting ? "Submitting..." : "Create payout"}
      </button>
    </form>
  );
}