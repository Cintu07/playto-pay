import { FormEvent, useState } from "react";

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

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const normalizedAmount = Math.round(Number(amountRupees) * 100);
    if (!normalizedAmount || !bankAccountId) {
      return;
    }
    await onSubmit({ amountPaise: normalizedAmount, bankAccountId });
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-[2rem] bg-white p-6 shadow-panel">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="font-display text-xl font-bold text-ink">Request payout</p>
          <p className="mt-1 text-sm text-slate">Funds are held immediately and settled by the background worker.</p>
        </div>
        <div className="rounded-full bg-sand px-4 py-2 font-mono text-xs uppercase tracking-[0.24em] text-slate">Async only</div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <label className="block text-sm text-slate">
          Amount in INR
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
          Bank account
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
        This request will create a hold first. For example, ₹{amountRupees || "0"} becomes {formatPaise(Math.round(Number(amountRupees || "0") * 100))} in paise.
      </div>

      <button
        type="submit"
        disabled={isSubmitting || !bankAccounts.length}
        className="mt-6 inline-flex items-center rounded-full bg-ink px-5 py-3 text-sm font-medium text-white transition hover:translate-y-[-1px] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSubmitting ? "Submitting..." : "Create payout"}
      </button>
    </form>
  );
}