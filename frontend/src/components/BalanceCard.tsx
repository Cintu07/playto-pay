type BalanceCardProps = {
  label: string;
  value: string;
  tone: "ink" | "spruce" | "coral";
};

const toneClasses = {
  ink: "bg-ink text-white",
  spruce: "bg-spruce text-white",
  coral: "bg-coral text-white",
};

const noteMap = {
  ink: "Ready to withdraw",
  spruce: "Reserved by open payouts",
  coral: "Available plus held",
};

export function BalanceCard({ label, value, tone }: BalanceCardProps) {
  return (
    <article className={`rounded-[2rem] p-6 shadow-panel ${toneClasses[tone]}`}>
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm uppercase tracking-[0.24em] text-white/75">{label}</p>
        <div className="rounded-full bg-white/15 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.2em] text-white/70">
          Ledger
        </div>
      </div>
      <p className="mt-6 text-3xl font-bold md:text-4xl">{value}</p>
      <p className="mt-2 text-sm text-white/70">{noteMap[tone]}</p>
    </article>
  );
}