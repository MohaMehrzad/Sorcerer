"use client";

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  FormEvent,
} from "react";
import Markdown from "./Markdown";
import { Message } from "@/lib/store";

interface AttachedFile {
  path: string;
  content: string;
}

interface ChatAreaProps {
  messages: Message[];
  onSend: (messages: Message[], newMessage: string, withSearch: boolean, attachedFiles?: AttachedFile[]) => void;
  attachedFiles: AttachedFile[];
  onAttachedFilesChange: (files: AttachedFile[]) => void;
  botName: string;
  modelName: string;
  onOpenBotSetup: () => void;
  loading: boolean;
  searching: boolean;
  searchEnabled: boolean;
  onToggleSearch: () => void;
  onToggleSidebar: () => void;
  onToggleFiles: () => void;
  onToggleAutonomous: () => void;
}

export type { AttachedFile };

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function AutoResizeTextarea({
  value,
  onChange,
  onKeyDown,
  disabled,
  inputRef,
}: {
  value: string;
  onChange: (v: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  disabled: boolean;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  useEffect(() => {
    const el = inputRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 160) + "px";
    }
  }, [value, inputRef]);

  return (
    <textarea
      ref={inputRef}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      placeholder="Type a message..."
      rows={1}
      className="flex-1 resize-none rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder:text-neutral-400 disabled:opacity-50 transition-colors"
      disabled={disabled}
    />
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function GlobeIcon({ className }: { className?: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

export default function ChatArea({
  messages,
  onSend,
  attachedFiles,
  onAttachedFilesChange,
  botName,
  modelName,
  onOpenBotSetup,
  loading,
  searching,
  searchEnabled,
  onToggleSearch,
  onToggleSidebar,
  onToggleFiles,
  onToggleAutonomous,
}: ChatAreaProps) {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const botInitials = useMemo(() => {
    const normalized = botName.trim();
    if (!normalized) return "AI";
    return normalized.slice(0, 2).toUpperCase();
  }, [botName]);

  useEffect(() => {
    if (isAtBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isAtBottom]);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const threshold = 100;
    setIsAtBottom(
      el.scrollHeight - el.scrollTop - el.clientHeight < threshold
    );
  }, []);

  function removeAttachedFile(path: string) {
    onAttachedFilesChange(attachedFiles.filter((file) => file.path !== path));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    const files = attachedFiles.length > 0 ? [...attachedFiles] : undefined;
    onAttachedFilesChange([]);
    onSend(messages, text, searchEnabled, files);
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  }

  function scrollToBottom() {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    setIsAtBottom(true);
  }

  return (
    <div className="flex-1 flex flex-col h-dvh min-w-0">
      {/* Header */}
      <header className="flex items-center gap-3 px-4 py-3 border-b border-neutral-200 dark:border-neutral-800 bg-white/80 dark:bg-neutral-950/80 backdrop-blur-md sticky top-0 z-10">
        <button
          onClick={onToggleSidebar}
          className="p-2 -ml-1 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors md:hidden cursor-pointer"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-semibold truncate">{botName}</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onOpenBotSetup}
            className="text-xs px-2 py-1 rounded border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
            title="Configure bot"
          >
            Bot Setup
          </button>
          {searching && (
            <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 animate-pulse">
              <SearchIcon />
              <span>Searching web...</span>
            </div>
          )}
          {loading && !searching && (
            <div className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400">
              <div className="flex gap-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-bounce [animation-delay:-0.3s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-bounce [animation-delay:-0.15s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-bounce" />
              </div>
              <span>Generating</span>
            </div>
          )}
        </div>
      </header>

      {/* Messages */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto"
      >
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full px-4 gap-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg">
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <div className="text-center">
              <h2 className="text-lg font-semibold text-neutral-800 dark:text-neutral-200">
                Start a conversation
              </h2>
              <p className="text-sm text-neutral-400 mt-1 max-w-xs">
                Send a message to begin chatting with {botName} ({modelName})
              </p>
            </div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
            {messages.map((msg, i) => (
              <div key={i} className="group">
                {msg.role === "user" ? (
                  <div className="flex justify-end">
                    <div className="max-w-[85%] flex flex-col items-end gap-1">
                      <div className="rounded-2xl rounded-br-md px-4 py-3 bg-blue-600 text-white text-sm whitespace-pre-wrap leading-relaxed shadow-sm">
                        {msg.content}
                      </div>
                      <span className="text-[11px] text-neutral-400 px-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {formatTime(msg.timestamp)}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-3">
                    <div className="shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center text-white text-xs font-bold shadow-sm mt-0.5">
                      {botInitials}
                    </div>
                    <div className="max-w-[85%] flex flex-col gap-1 min-w-0">
                      <div className="rounded-2xl rounded-tl-md px-4 py-3 bg-neutral-100 dark:bg-neutral-800/80 text-sm leading-relaxed shadow-sm">
                        {msg.content ? (
                          <Markdown content={msg.content} />
                        ) : loading && i === messages.length - 1 ? (
                          <div className="flex gap-1 py-1">
                            <span className="w-2 h-2 rounded-full bg-neutral-400 animate-bounce [animation-delay:-0.3s]" />
                            <span className="w-2 h-2 rounded-full bg-neutral-400 animate-bounce [animation-delay:-0.15s]" />
                            <span className="w-2 h-2 rounded-full bg-neutral-400 animate-bounce" />
                          </div>
                        ) : null}
                      </div>
                      <span className="text-[11px] text-neutral-400 px-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {formatTime(msg.timestamp)}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Scroll to bottom */}
      {!isAtBottom && messages.length > 0 && (
        <div className="flex justify-center -mt-12 relative z-10 pointer-events-none">
          <button
            onClick={scrollToBottom}
            className="pointer-events-auto p-2 rounded-full bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 shadow-lg hover:shadow-xl transition-all cursor-pointer"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </div>
      )}

      {/* Input area */}
      <div className="border-t border-neutral-200 dark:border-neutral-800 bg-white/80 dark:bg-neutral-950/80 backdrop-blur-md px-4 py-3">
        {/* Attached files chips */}
        {attachedFiles.length > 0 && (
          <div className="max-w-3xl mx-auto flex flex-wrap gap-1.5 mb-2">
            {attachedFiles.map((f) => (
              <span
                key={f.path}
                className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                <span className="max-w-[150px] truncate">{f.path}</span>
                <button
                  type="button"
                  onClick={() => removeAttachedFile(f.path)}
                  className="ml-0.5 hover:text-red-500 transition-colors cursor-pointer"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </span>
            ))}
          </div>
        )}
        <form
          onSubmit={handleSubmit}
          className="max-w-3xl mx-auto flex gap-2 items-end"
        >
          <AutoResizeTextarea
            value={input}
            onChange={setInput}
            onKeyDown={handleKeyDown}
            disabled={loading}
            inputRef={inputRef}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="shrink-0 p-3 rounded-xl bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
            title="Send message"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </form>

        {/* Bottom bar: search toggle + file explorer + hints */}
        <div className="max-w-3xl mx-auto flex items-center justify-between mt-2 px-1">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onToggleSearch}
              className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                searchEnabled
                  ? "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800"
                  : "text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              }`}
              title={searchEnabled ? "Web search enabled" : "Enable web search"}
            >
              <GlobeIcon />
              <span>{searchEnabled ? "Search on" : "Search"}</span>
            </button>
            <button
              type="button"
              onClick={onToggleFiles}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-all cursor-pointer"
              title="Attach file"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
              <span>Files</span>
            </button>
            <button
              type="button"
              onClick={onToggleAutonomous}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-all cursor-pointer"
              title="Open autonomous agent"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="10" rx="2" />
                <circle cx="12" cy="5" r="2" />
                <path d="M12 7v4" />
                <line x1="8" y1="16" x2="8" y2="16" />
                <line x1="16" y1="16" x2="16" y2="16" />
              </svg>
              <span>Agent</span>
            </button>
          </div>
          <span className="text-[11px] text-neutral-400">
            Enter to send &middot; Shift+Enter for new line
          </span>
        </div>
      </div>
    </div>
  );
}
