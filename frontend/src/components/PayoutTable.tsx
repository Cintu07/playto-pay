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
    <section className="rounded-[2.25rem] bg-white p-6 shadow-panel md:p-7">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="font-display text-xl font-bold text-ink">Payout history</p>
          <p className="mt-1 text-sm text-slate">Status auto-refreshes every five seconds.</p>
        </div>
        <div className="rounded-full bg-sand px-4 py-2 font-mono text-[11px] uppercase tracking-[0.24em] text-slate">Newest first</div>
      </div>

      <div className="mt-6 space-y-3">
        {payouts.length === 0 ? (
          <div className="rounded-[1.6rem] border border-dashed border-sand bg-sand/30 px-5 py-8 text-sm text-slate">
            No payouts yet. Create one from the form and this list will update automatically.
          </div>
        ) : null}

        {payouts.map((payout) => (
          <article key={payout.id} className="rounded-[1.7rem] border border-sand bg-sand/45 p-4 text-ink">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-lg font-semibold text-ink">{formatPaise(payout.amount_paise)}</p>
                <p className="mt-1 text-sm text-slate">{payout.bank_account.bank_name} · {payout.bank_account.label}</p>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-medium capitalize ${toneMap[payout.status] || "bg-slate-100 text-slate-800"}`}>
                {payout.status}
              </span>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl bg-white px-4 py-3">
                <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-slate">Attempts</p>
                <p className="mt-2 text-sm font-semibold text-ink">{payout.attempt_count}</p>
              </div>
              <div className="rounded-2xl bg-white px-4 py-3">
                <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-slate">Retry at</p>
                <p className="mt-2 text-sm font-semibold text-ink">{formatTimestamp(payout.next_retry_at)}</p>
              </div>
              <div className="rounded-2xl bg-white px-4 py-3">
                <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-slate">Created</p>
                <p className="mt-2 text-sm font-semibold text-ink">{formatTimestamp(payout.created_at)}</p>
              </div>
            </div>

            {payout.failure_reason ? <p className="mt-3 text-sm text-rose-700">{payout.failure_reason}</p> : null}
          </article>
        ))}
      </div>
    </section>
  );
}