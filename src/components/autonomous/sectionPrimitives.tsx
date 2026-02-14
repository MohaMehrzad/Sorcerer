import { ReactNode } from "react";

export const cardClass =
  "rounded-2xl border border-white/10 bg-neutral-900/95 shadow-[0_14px_40px_rgba(2,8,20,0.55)]";
export const cardHeaderClass =
  "px-4 py-3 border-b border-white/10 text-sm font-semibold text-neutral-100";
export const cardBodyClass = "p-4";
export const summaryClass = "cursor-pointer text-sm font-semibold text-neutral-100";

interface SectionCardProps {
  title: string;
  children: ReactNode;
}

export function SectionCard({ title, children }: SectionCardProps) {
  return (
    <section className={cardClass}>
      <div className={cardHeaderClass}>{title}</div>
      <div className={`${cardBodyClass} space-y-4`}>{children}</div>
    </section>
  );
}

interface CollapsibleCardProps {
  title: string;
  open: boolean;
  onToggle: (open: boolean) => void;
  children: ReactNode;
}

export function CollapsibleCard({
  title,
  open,
  onToggle,
  children,
}: CollapsibleCardProps) {
  return (
    <details
      className={cardClass}
      open={open}
      onToggle={(event) => onToggle(event.currentTarget.open)}
    >
      <summary className={`${cardHeaderClass} ${summaryClass}`}>{title}</summary>
      <div className={`${cardBodyClass} space-y-4`}>{children}</div>
    </details>
  );
}
