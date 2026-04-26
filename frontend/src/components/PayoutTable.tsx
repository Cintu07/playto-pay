import type { Payout } from "../lib/api";
import { formatPaise, formatTimestamp } from "../lib/api";

type PayoutTableProps = {
  payouts: Payout[];
};

const toneMap: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800",
  processing: "bg-sky-100 text-sky-800",
  completed: "bg-emerald-100 text-emerald-800",
  failed: "bg-rose-100 text-rose-800",
};

export function PayoutTable({ payouts }: PayoutTableProps) {
  return (
    <section className="rounded-[2rem] bg-white p-6 shadow-panel">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="font-display text-xl font-bold text-ink">Payout history</p>
          <p className="mt-1 text-sm text-slate">Status auto-refreshes every five seconds.</p>
        </div>
      </div>

      <div className="mt-6 overflow-x-auto">
        <table className="min-w-full border-separate border-spacing-y-3 text-left">
          <thead className="text-xs uppercase tracking-[0.24em] text-slate">
            <tr>
              <th>Amount</th>
              <th>Status</th>
              <th>Bank</th>
              <th>Attempts</th>
              <th>Retry at</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {payouts.map((payout) => (
              <tr key={payout.id} className="bg-sand/70 text-sm text-ink">
                <td className="rounded-l-2xl px-4 py-3 font-mono">{formatPaise(payout.amount_paise)}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-3 py-1 text-xs font-medium capitalize ${toneMap[payout.status] || "bg-slate-100 text-slate-800"}`}>
                    {payout.status}
                  </span>
                  {payout.failure_reason ? <p className="mt-2 text-xs text-rose-700">{payout.failure_reason}</p> : null}
                </td>
                <td className="px-4 py-3">{payout.bank_account.bank_name}</td>
                <td className="px-4 py-3 font-mono">{payout.attempt_count}</td>
                <td className="px-4 py-3">{formatTimestamp(payout.next_retry_at)}</td>
                <td className="rounded-r-2xl px-4 py-3">{formatTimestamp(payout.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}