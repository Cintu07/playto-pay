import type { LedgerEntry } from "../lib/api";
import { formatPaise, formatTimestamp } from "../lib/api";

type LedgerTableProps = {
  entries: LedgerEntry[];
};

export function LedgerTable({ entries }: LedgerTableProps) {
  return (
    <section className="rounded-[2rem] bg-white p-6 shadow-panel">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="font-display text-xl font-bold text-ink">Ledger movement</p>
          <p className="mt-1 text-sm text-slate">Every number here is stored as paise on the backend.</p>
        </div>
      </div>

      <div className="mt-6 overflow-x-auto">
        <table className="min-w-full border-separate border-spacing-y-3 text-left">
          <thead className="text-xs uppercase tracking-[0.24em] text-slate">
            <tr>
              <th>Type</th>
              <th>Available delta</th>
              <th>Held delta</th>
              <th>Description</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id} className="rounded-2xl bg-sand/70 text-sm text-ink">
                <td className="rounded-l-2xl px-4 py-3 capitalize">{entry.entry_type}</td>
                <td className="px-4 py-3 font-mono">{formatPaise(entry.available_delta_paise)}</td>
                <td className="px-4 py-3 font-mono">{formatPaise(entry.held_delta_paise)}</td>
                <td className="px-4 py-3">{entry.description || entry.reference}</td>
                <td className="rounded-r-2xl px-4 py-3">{formatTimestamp(entry.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}