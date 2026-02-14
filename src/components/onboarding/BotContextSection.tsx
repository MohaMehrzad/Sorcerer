interface BotContextSectionProps {
  botContext: string;
  setBotContext: (value: string) => void;
}

export default function BotContextSection({ botContext, setBotContext }: BotContextSectionProps) {
  return (
    <details className="rounded-2xl border border-black/10 dark:border-white/10 bg-white/70 dark:bg-neutral-950/70 p-4">
      <summary className="cursor-pointer text-sm font-semibold text-neutral-700 dark:text-neutral-200">
        Bot Context (Optional)
      </summary>
      <div className="mt-3">
        <textarea
          value={botContext}
          onChange={(event) => setBotContext(event.target.value)}
          placeholder="Tone, constraints, domain rules, preferred style..."
          className="w-full min-h-[96px] rounded-xl border border-black/10 dark:border-white/10 bg-white/80 dark:bg-neutral-900 px-3 py-2"
        />
      </div>
    </details>
  );
}
