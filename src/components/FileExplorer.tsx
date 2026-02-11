"use client";

import { useState, useEffect, useCallback } from "react";

interface TreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: TreeNode[];
}

interface FileExplorerProps {
  open: boolean;
  onClose: () => void;
  onAttachFile: (path: string, content: string) => void;
  workspacePath?: string;
}

function FileIcon({ type, name }: { type: "file" | "directory"; name: string }) {
  if (type === "directory") {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-400 shrink-0">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>
    );
  }
  // Color by extension
  const ext = name.split(".").pop()?.toLowerCase() || "";
  const colors: Record<string, string> = {
    ts: "text-blue-400",
    tsx: "text-blue-400",
    js: "text-yellow-400",
    jsx: "text-yellow-400",
    py: "text-green-400",
    rs: "text-orange-400",
    c: "text-purple-400",
    cpp: "text-purple-400",
    java: "text-red-400",
    json: "text-yellow-500",
    md: "text-neutral-400",
    css: "text-pink-400",
    html: "text-orange-400",
  };
  const color = colors[ext] || "text-neutral-400";

  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`${color} shrink-0`}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function TreeItem({
  node,
  depth,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  onSelect: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 1);

  return (
    <div>
      <button
        onClick={() => {
          if (node.type === "directory") {
            setExpanded((e) => !e);
          } else {
            onSelect(node.path);
          }
        }}
        className="w-full flex items-center gap-1.5 px-2 py-1 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded transition-colors text-left cursor-pointer"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {node.type === "directory" && (
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="currentColor"
            className={`shrink-0 text-neutral-400 transition-transform ${expanded ? "rotate-90" : ""}`}
          >
            <polygon points="6,4 18,12 6,20" />
          </svg>
        )}
        {node.type === "file" && <span className="w-[10px]" />}
        <FileIcon type={node.type} name={node.name} />
        <span className="truncate text-neutral-700 dark:text-neutral-300">
          {node.name}
        </span>
      </button>
      {node.type === "directory" && expanded && node.children && (
        <div>
          {node.children.map((child) => (
            <TreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function FileExplorer({
  open,
  onClose,
  onAttachFile,
  workspacePath,
}: FileExplorerProps) {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<{
    path: string;
    content: string;
  } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const loadTree = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "tree", workspacePath }),
      });
      const data = await res.json();
      setTree(data.tree || []);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [workspacePath]);

  useEffect(() => {
    if (open) loadTree();
  }, [open, loadTree]);

  async function handleSelect(filePath: string) {
    setPreviewLoading(true);
    try {
      const res = await fetch("/api/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "read", path: filePath, workspacePath }),
      });
      const data = await res.json();
      if (data.error) {
        setPreview({ path: filePath, content: `Error: ${data.error}` });
      } else {
        setPreview({ path: filePath, content: data.content });
      }
    } catch {
      setPreview({ path: filePath, content: "Failed to read file" });
    } finally {
      setPreviewLoading(false);
    }
  }

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 bg-black/40 z-40"
        onClick={onClose}
      />
      <div className="fixed inset-y-0 right-0 w-full max-w-2xl bg-white dark:bg-neutral-900 border-l border-neutral-200 dark:border-neutral-800 z-50 flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-200 dark:border-neutral-800">
          <div>
            <h2 className="text-sm font-semibold">File Explorer</h2>
            <p className="text-[11px] text-neutral-500 mt-0.5 font-mono truncate max-w-[420px]">
              Workspace: {workspacePath?.trim() || "(default workspace)"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={loadTree}
              className="text-xs px-2 py-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-500 cursor-pointer"
              title="Refresh"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
            </button>
            <button
              onClick={onClose}
              className="text-xs px-2 py-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-500 cursor-pointer"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Tree panel */}
          <div className="w-64 border-r border-neutral-200 dark:border-neutral-800 overflow-y-auto py-2">
            {loading ? (
              <div className="px-4 py-8 text-xs text-neutral-400 text-center">
                Loading...
              </div>
            ) : tree.length === 0 ? (
              <div className="px-4 py-8 text-xs text-neutral-400 text-center">
                No files found
              </div>
            ) : (
              tree.map((node) => (
                <TreeItem
                  key={node.path}
                  node={node}
                  depth={0}
                  onSelect={handleSelect}
                />
              ))
            )}
          </div>

          {/* Preview panel */}
          <div className="flex-1 flex flex-col min-w-0">
            {preview ? (
              <>
                <div className="flex items-center justify-between px-4 py-2 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-800/50">
                  <span className="text-xs font-mono text-neutral-500 truncate">
                    {preview.path}
                  </span>
                  <button
                    onClick={() => {
                      onAttachFile(preview.path, preview.content);
                      onClose();
                    }}
                    className="shrink-0 flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors cursor-pointer"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                    </svg>
                    Attach to chat
                  </button>
                </div>
                <div className="flex-1 overflow-auto p-4">
                  {previewLoading ? (
                    <div className="text-xs text-neutral-400">Loading...</div>
                  ) : (
                    <pre className="text-xs font-mono text-neutral-700 dark:text-neutral-300 whitespace-pre-wrap break-words">
                      {preview.content}
                    </pre>
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-xs text-neutral-400">
                Select a file to preview
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
