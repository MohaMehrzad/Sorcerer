"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { useState, useCallback } from "react";
import { apiFetch } from "@/lib/client/apiFetch";

const RUNNABLE_LANGUAGES = new Set([
  // Interpreted
  "python", "python3", "py",
  "javascript", "js",
  "typescript", "ts",
  "bash", "sh", "zsh",
  "ruby", "rb",
  "perl", "pl",
  // Compiled
  "c", "cpp", "c++",
  "rust", "rs",
  "swift",
  "java",
  "go",
]);

const EXT_MAP: Record<string, string> = {
  python: ".py",
  py: ".py",
  python3: ".py",
  javascript: ".js",
  js: ".js",
  typescript: ".ts",
  ts: ".ts",
  c: ".c",
  cpp: ".cpp",
  "c++": ".cpp",
  rust: ".rs",
  rs: ".rs",
  java: ".java",
  swift: ".swift",
  go: ".go",
  ruby: ".rb",
  rb: ".rb",
  perl: ".pl",
  pl: ".pl",
  bash: ".sh",
  sh: ".sh",
  zsh: ".sh",
  html: ".html",
  css: ".css",
  json: ".json",
  yaml: ".yaml",
  yml: ".yml",
  sql: ".sql",
  xml: ".xml",
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className="text-xs px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-neutral-300 hover:text-white transition-all cursor-pointer"
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

function RunButton({
  code,
  language,
}: {
  code: string;
  language: string;
}) {
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [exitCode, setExitCode] = useState<number | null>(null);

  const handleRun = useCallback(async () => {
    setRunning(true);
    setOutput(null);
    setExitCode(null);

    try {
      const res = await apiFetch("/api/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, language }),
      });

      const data = await res.json();

      if (!res.ok) {
        setOutput(data.error || `HTTP ${res.status}`);
        setExitCode(1);
      } else {
        setOutput(data.output);
        setExitCode(data.exitCode);
      }
    } catch (err) {
      setOutput(
        `Failed: ${err instanceof Error ? err.message : "Unknown error"}`
      );
      setExitCode(1);
    } finally {
      setRunning(false);
    }
  }, [code, language]);

  return (
    <div>
      <div className="flex items-center gap-2">
        <button
          onClick={handleRun}
          disabled={running}
          className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-emerald-600/80 hover:bg-emerald-500 disabled:bg-neutral-600 text-white transition-all cursor-pointer disabled:cursor-wait"
        >
          {running ? (
            <>
              <svg
                className="animate-spin w-3 h-3"
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="3"
                  className="opacity-25"
                />
                <path
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  fill="currentColor"
                  className="opacity-75"
                />
              </svg>
              Running...
            </>
          ) : (
            <>
              <svg
                width="10"
                height="12"
                viewBox="0 0 10 12"
                fill="currentColor"
              >
                <polygon points="0,0 10,6 0,12" />
              </svg>
              Run
            </>
          )}
        </button>
        {output !== null && (
          <button
            onClick={() => {
              setOutput(null);
              setExitCode(null);
            }}
            className="text-xs text-neutral-400 hover:text-neutral-200 cursor-pointer"
          >
            Clear
          </button>
        )}
      </div>

      {output !== null && (
        <div
          className={`mt-2 rounded-lg border text-xs font-mono whitespace-pre-wrap p-3 max-h-64 overflow-auto ${
            exitCode === 0
              ? "bg-neutral-950 border-neutral-700 text-neutral-200"
              : "bg-red-950/50 border-red-800/50 text-red-200"
          }`}
        >
          <div className="flex items-center gap-2 mb-2 pb-2 border-b border-neutral-800">
            <span
              className={`w-2 h-2 rounded-full ${exitCode === 0 ? "bg-emerald-500" : "bg-red-500"}`}
            />
            <span className="text-neutral-500">
              {exitCode === 0 ? "Output" : `Exit code ${exitCode}`}
            </span>
          </div>
          {output}
        </div>
      )}
    </div>
  );
}

function SaveButton({ code, language }: { code: string; language: string }) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = useCallback(async () => {
    const ext = EXT_MAP[language.toLowerCase()] || `.${language}`;
    const filename = prompt(`Save as:`, `untitled${ext}`);
    if (!filename) return;

    setSaving(true);
    try {
      const res = await apiFetch("/api/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "write", path: filename, content: code }),
      });
      const data = await res.json();
      if (data.success) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } else {
        alert(`Failed: ${data.error}`);
      }
    } catch {
      alert("Save failed");
    } finally {
      setSaving(false);
    }
  }, [code, language]);

  return (
    <button
      onClick={handleSave}
      disabled={saving}
      className="text-xs px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-neutral-300 hover:text-white transition-all cursor-pointer"
    >
      {saved ? "Saved!" : saving ? "..." : "Save"}
    </button>
  );
}

function CodeBlock({
  language,
  code,
}: {
  language: string;
  code: string;
}) {
  const canRun = RUNNABLE_LANGUAGES.has(language.toLowerCase());

  return (
    <div className="relative group my-3 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-neutral-900 border-b border-neutral-700">
        <span className="text-xs text-neutral-400 font-mono">{language}</span>
        <div className="flex items-center gap-2">
          {canRun && <RunButton code={code} language={language} />}
          <SaveButton code={code} language={language} />
          <CopyButton text={code} />
        </div>
      </div>
      <SyntaxHighlighter
        style={oneDark}
        language={language}
        PreTag="div"
        customStyle={{
          margin: 0,
          borderRadius: 0,
          fontSize: "0.8125rem",
        }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}

export default function Markdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ className, children, ...props }) {
          const match = /language-([A-Za-z0-9_+-]+)/.exec(className || "");
          const codeString = String(children).replace(/\n$/, "");

          if (match) {
            return <CodeBlock language={match[1]} code={codeString} />;
          }

          return (
            <code
              className="px-1.5 py-0.5 rounded bg-neutral-200 dark:bg-neutral-700 text-[0.8125rem] font-mono"
              {...props}
            >
              {children}
            </code>
          );
        },
        p({ children }) {
          return <p className="mb-3 last:mb-0 leading-relaxed">{children}</p>;
        },
        ul({ children }) {
          return (
            <ul className="mb-3 last:mb-0 list-disc list-inside space-y-1">
              {children}
            </ul>
          );
        },
        ol({ children }) {
          return (
            <ol className="mb-3 last:mb-0 list-decimal list-inside space-y-1">
              {children}
            </ol>
          );
        },
        blockquote({ children }) {
          return (
            <blockquote className="border-l-3 border-neutral-300 dark:border-neutral-600 pl-4 my-3 text-neutral-600 dark:text-neutral-400 italic">
              {children}
            </blockquote>
          );
        },
        table({ children }) {
          return (
            <div className="overflow-x-auto my-3">
              <table className="min-w-full border border-neutral-300 dark:border-neutral-700 text-sm">
                {children}
              </table>
            </div>
          );
        },
        th({ children }) {
          return (
            <th className="px-3 py-2 border-b border-neutral-300 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-800 text-left font-semibold">
              {children}
            </th>
          );
        },
        td({ children }) {
          return (
            <td className="px-3 py-2 border-b border-neutral-200 dark:border-neutral-800">
              {children}
            </td>
          );
        },
        a({ href, children }) {
          return (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 dark:text-blue-400 underline underline-offset-2 hover:text-blue-700 dark:hover:text-blue-300"
            >
              {children}
            </a>
          );
        },
        h1({ children }) {
          return (
            <h1 className="text-xl font-bold mb-3 mt-4 first:mt-0">
              {children}
            </h1>
          );
        },
        h2({ children }) {
          return (
            <h2 className="text-lg font-bold mb-2 mt-4 first:mt-0">
              {children}
            </h2>
          );
        },
        h3({ children }) {
          return (
            <h3 className="text-base font-bold mb-2 mt-3 first:mt-0">
              {children}
            </h3>
          );
        },
        hr() {
          return (
            <hr className="my-4 border-neutral-200 dark:border-neutral-700" />
          );
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
