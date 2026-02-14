interface PanelHeaderProps {
  embedded: boolean;
  botName?: string;
  expertMode: boolean;
  setExpertMode: (value: boolean) => void;
  statusClass: string;
  statusLabel: string;
  onClose?: () => void;
}

function ModeToggle({
  expertMode,
  setExpertMode,
}: {
  expertMode: boolean;
  setExpertMode: (value: boolean) => void;
}) {
  return (
    <div className="inline-flex rounded-full border border-white/15 bg-neutral-800 p-1 text-xs">
      <button
        type="button"
        onClick={() => setExpertMode(false)}
        className={`px-3 py-1 rounded-full transition-colors cursor-pointer ${
          !expertMode ? "bg-emerald-600 text-white" : "text-neutral-300 hover:bg-neutral-700"
        }`}
        aria-pressed={!expertMode}
      >
        Simple
      </button>
      <button
        type="button"
        onClick={() => setExpertMode(true)}
        className={`px-3 py-1 rounded-full transition-colors cursor-pointer ${
          expertMode ? "bg-emerald-600 text-white" : "text-neutral-300 hover:bg-neutral-700"
        }`}
        aria-pressed={expertMode}
      >
        Expert
      </button>
    </div>
  );
}

function StatusPill({ statusClass, statusLabel }: { statusClass: string; statusLabel: string }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${statusClass}`}>
      {statusLabel}
    </span>
  );
}

export default function PanelHeader({
  embedded,
  botName,
  expertMode,
  setExpertMode,
  statusClass,
  statusLabel,
  onClose,
}: PanelHeaderProps) {
  if (embedded) {
    return (
      <div className="flex items-center justify-end gap-3">
        <ModeToggle expertMode={expertMode} setExpertMode={setExpertMode} />
        <StatusPill statusClass={statusClass} statusLabel={statusLabel} />
      </div>
    );
  }

  return (
    <header className="border-b border-white/10 bg-neutral-900/90 backdrop-blur">
      <div className="px-6 py-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.3em] text-neutral-400">
            Autonomous Agent
          </p>
          <h2 id="autonomous-panel-title" className="text-lg font-semibold text-neutral-100">
            {(botName || "Assistant").trim()} Run Console
          </h2>
          <p className="text-xs text-neutral-400">
            Live planning, code edits, quality gates, and completion tracking.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <ModeToggle expertMode={expertMode} setExpertMode={setExpertMode} />
          <StatusPill statusClass={statusClass} statusLabel={statusLabel} />
          {onClose && (
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-neutral-800 transition-colors cursor-pointer"
              title="Close"
              aria-label="Close autonomous panel"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
