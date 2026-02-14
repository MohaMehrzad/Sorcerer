import { RefObject } from "react";

interface ConnectionSectionProps {
  firstInputRef: RefObject<HTMLInputElement | null>;
  botName: string;
  workspacePath: string;
  apiKey: string;
  apiUrl: string;
  model: string;
  workspacePickerBusy: boolean;
  workspacePickerError: string | null;
  testingConnection: boolean;
  connectionSuccess: string | null;
  connectionError: string | null;
  onBotNameChange: (value: string) => void;
  onWorkspacePathChange: (value: string) => void;
  onWorkspacePathBlur: (value: string) => void;
  onPickWorkspace: () => void;
  onApiKeyChange: (value: string) => void;
  onApiUrlChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onTestConnection: () => void;
  defaultApiUrl: string;
  defaultModel: string;
}

export default function ConnectionSection({
  firstInputRef,
  botName,
  workspacePath,
  apiKey,
  apiUrl,
  model,
  workspacePickerBusy,
  workspacePickerError,
  testingConnection,
  connectionSuccess,
  connectionError,
  onBotNameChange,
  onWorkspacePathChange,
  onWorkspacePathBlur,
  onPickWorkspace,
  onApiKeyChange,
  onApiUrlChange,
  onModelChange,
  onTestConnection,
  defaultApiUrl,
  defaultModel,
}: ConnectionSectionProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <label className="block text-sm">
        <span className="block text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-1">
          Bot Name
        </span>
        <input
          ref={firstInputRef}
          type="text"
          value={botName}
          onChange={(event) => onBotNameChange(event.target.value)}
          placeholder="e.g. Merlin, Athena, Forge"
          className="w-full rounded-xl border border-black/10 dark:border-white/10 bg-white/80 dark:bg-neutral-900 px-3 py-2"
        />
      </label>

      <label className="block text-sm">
        <span className="block text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-1">
          Workspace Folder
        </span>
        <input
          type="text"
          value={workspacePath}
          onChange={(event) => onWorkspacePathChange(event.target.value)}
          onBlur={(event) => onWorkspacePathBlur(event.target.value)}
          placeholder="/Users/you/Projects/my-repo or ."
          className="w-full rounded-xl border border-black/10 dark:border-white/10 bg-white/80 dark:bg-neutral-900 px-3 py-2 font-mono"
        />
        <span className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={onPickWorkspace}
            disabled={workspacePickerBusy}
            className="px-2.5 py-1.5 rounded-lg border border-black/10 dark:border-white/10 text-xs hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-60 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            {workspacePickerBusy ? "Opening..." : "Pick Workspace"}
          </button>
        </span>
        {workspacePickerError && (
          <span className="mt-1 block text-xs text-red-600 dark:text-red-400">
            {workspacePickerError}
          </span>
        )}
      </label>

      <label className="block text-sm md:col-span-2">
        <span className="block text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-1">
          Model API Key
        </span>
        <input
          type="password"
          value={apiKey}
          onChange={(event) => onApiKeyChange(event.target.value)}
          placeholder="sk-..."
          className="w-full rounded-xl border border-black/10 dark:border-white/10 bg-white/80 dark:bg-neutral-900 px-3 py-2 font-mono"
        />
        <span className="mt-1 block text-xs text-neutral-500">
          Stored only in browser session storage (clears on close).
        </span>
      </label>

      <label className="block text-sm">
        <span className="block text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-1">
          Model API URL
        </span>
        <input
          type="text"
          value={apiUrl}
          onChange={(event) => onApiUrlChange(event.target.value)}
          placeholder={defaultApiUrl}
          className="w-full rounded-xl border border-black/10 dark:border-white/10 bg-white/80 dark:bg-neutral-900 px-3 py-2 font-mono"
        />
      </label>

      <label className="block text-sm">
        <span className="block text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-1">
          Model Name
        </span>
        <input
          type="text"
          value={model}
          onChange={(event) => onModelChange(event.target.value)}
          placeholder={defaultModel}
          className="w-full rounded-xl border border-black/10 dark:border-white/10 bg-white/80 dark:bg-neutral-900 px-3 py-2 font-mono"
        />
      </label>

      <div className="md:col-span-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onTestConnection}
            disabled={testingConnection || !apiKey.trim() || !apiUrl.trim() || !model.trim()}
            className="px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 text-sm hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-60 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            {testingConnection ? "Testing..." : "Test Connection"}
          </button>
          {connectionSuccess && (
            <span className="text-sm text-emerald-600 dark:text-emerald-400">{connectionSuccess}</span>
          )}
        </div>
        {connectionError && <p className="mt-1 text-sm text-red-600 dark:text-red-400">{connectionError}</p>}
      </div>
    </div>
  );
}
