import { actionSummary, commandToString } from "@/components/autonomous/helpers";
import { AgentStep, VerificationCheckResult } from "@/components/autonomous/types";
import { CollapsibleCard } from "@/components/autonomous/sectionPrimitives";

interface ActivitySectionProps {
  open: boolean;
  onToggle: (open: boolean) => void;
  steps: AgentStep[];
  verificationChecks: VerificationCheckResult[];
}

export default function ActivitySection({
  open,
  onToggle,
  steps,
  verificationChecks,
}: ActivitySectionProps) {
  return (
    <CollapsibleCard title="Activity & Checks" open={open} onToggle={onToggle}>
      <div className="rounded-xl border border-black/10 dark:border-white/10 overflow-hidden">
        <div className="px-4 py-3 border-b border-black/10 dark:border-white/10 bg-white/70 dark:bg-neutral-900/40">
          <h3 className="text-sm font-semibold">Step Log</h3>
        </div>

        <div className="divide-y divide-black/10 dark:divide-white/10">
          {steps.map((step, index) => (
            <details key={`${step.iteration}-${step.phase}-${index}`} className="group" open={!step.ok}>
              <summary className="list-none cursor-pointer px-4 py-3 hover:bg-black/5 dark:hover:bg-white/10 transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs text-neutral-500">
                      <span>Step {step.iteration}</span>
                      <span>•</span>
                      <span>{step.phase}</span>
                      <span>•</span>
                      <span>{step.durationMs} ms</span>
                    </div>
                    <div className="text-sm font-medium mt-0.5 truncate">{actionSummary(step.action)}</div>
                    <p className="text-xs text-neutral-500 mt-1 line-clamp-2">{step.summary}</p>
                  </div>
                  <span
                    className={`shrink-0 mt-0.5 px-2 py-1 rounded text-xs font-medium ${
                      step.ok
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                        : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                    }`}
                  >
                    {step.ok ? "ok" : "failed"}
                  </span>
                </div>
              </summary>
              <div className="px-4 pb-4 space-y-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-1">
                    Thinking
                  </div>
                  <p className="text-sm whitespace-pre-wrap">{step.thinking}</p>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-1">
                    Action JSON
                  </div>
                  <pre className="text-xs rounded-lg bg-neutral-100 dark:bg-neutral-900 p-3 overflow-x-auto">
                    {JSON.stringify(step.action, null, 2)}
                  </pre>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-1">
                    Tool Output
                  </div>
                  <pre className="text-xs rounded-lg bg-neutral-100 dark:bg-neutral-900 p-3 overflow-auto max-h-56 whitespace-pre-wrap">
                    {step.output || "(no output)"}
                  </pre>
                </div>
              </div>
            </details>
          ))}
        </div>
      </div>

      {verificationChecks.length > 0 && (
        <div className="rounded-xl border border-black/10 dark:border-white/10 overflow-hidden">
          <div className="px-4 py-3 border-b border-black/10 dark:border-white/10 bg-white/70 dark:bg-neutral-900/40">
            <h3 className="text-sm font-semibold">Verification Checks</h3>
          </div>
          <div className="divide-y divide-black/10 dark:divide-white/10">
            {verificationChecks.map((check, index) => (
              <details key={`${check.attempt}-${index}`}>
                <summary className="list-none cursor-pointer px-4 py-3 hover:bg-black/5 dark:hover:bg-white/10 transition-colors">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs text-neutral-500">Attempt {check.attempt}</div>
                      <div className="text-sm font-mono truncate">{commandToString(check.command)}</div>
                    </div>
                    <span
                      className={`shrink-0 px-2 py-1 rounded text-xs font-medium ${
                        check.ok
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                          : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                      }`}
                    >
                      {check.ok ? "pass" : "fail"}
                    </span>
                  </div>
                </summary>
                <div className="px-4 pb-4">
                  <pre className="text-xs rounded-lg bg-neutral-100 dark:bg-neutral-900 p-3 overflow-auto max-h-56 whitespace-pre-wrap">
                    {check.output || "(no output)"}
                  </pre>
                </div>
              </details>
            ))}
          </div>
        </div>
      )}
    </CollapsibleCard>
  );
}
