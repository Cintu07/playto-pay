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

export function BalanceCard({ label, value, tone }: BalanceCardProps) {
  return (
    <article className={`rounded-[2rem] p-6 shadow-panel ${toneClasses[tone]}`}>
      <p className="text-sm uppercase tracking-[0.24em] text-white/75">{label}</p>
      <p className="mt-4 text-3xl font-bold md:text-4xl">{value}</p>
    </article>
  );
}