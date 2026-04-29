import type { LedgerEntry } from "../lib/api";
import { formatPaise, formatTimestamp } from "../lib/api";

type LedgerTableProps = {
  entries: LedgerEntry[];
};

export function LedgerTable({ entries }: LedgerTableProps) {
  return (
    <section className="rounded-[2.25rem] bg-white p-6 shadow-panel md:p-7">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="font-display text-xl font-bold text-ink">Ledger movement</p>
          <p className="mt-1 text-sm text-slate">Every number here is stored as paise on the backend.</p>
        </div>
      </div>

      <div className="mt-6 space-y-3">
        {entries.map((entry) => (
          <article key={entry.id} className="rounded-[1.7rem] border border-sand bg-sand/45 p-4 text-ink">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-slate">{entry.entry_type}</p>
                <p className="mt-2 text-base font-semibold text-ink">{entry.description || entry.reference}</p>
              </div>
              <p className="text-sm text-slate">{formatTimestamp(entry.created_at)}</p>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl bg-white px-4 py-3">
                <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-slate">Available delta</p>
                <p className="mt-2 font-mono text-lg font-semibold text-ink">{formatPaise(entry.available_delta_paise)}</p>
              </div>
              <div className="rounded-2xl bg-white px-4 py-3">
                <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-slate">Held delta</p>
                <p className="mt-2 font-mono text-lg font-semibold text-ink">{formatPaise(entry.held_delta_paise)}</p>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}