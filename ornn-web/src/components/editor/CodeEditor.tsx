/**
 * Code Editor Component.
 * Syntax-highlighted code editor with multi-tab support.
 * Cyberpunk styled with neon accents.
 * @module components/editor/CodeEditor
 */

import { useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";

export interface EditorTab {
  id: string;
  name: string;
  content: string;
  language?: string;
  isModified?: boolean;
}

export interface CodeEditorProps {
  tabs: EditorTab[];
  activeTabId: string;
  onTabChange: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onContentChange: (tabId: string, content: string) => void;
  onSave?: (tabId: string) => void;
  readOnly?: boolean;
  className?: string;
}

/** Close icon */
function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

/** Get language from file extension */
function getLanguageFromFilename(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  const langMap: Record<string, string> = {
    js: "javascript",
    ts: "typescript",
    jsx: "javascript",
    tsx: "typescript",
    py: "python",
    rb: "ruby",
    go: "go",
    rs: "rust",
    md: "markdown",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    html: "html",
    css: "css",
    scss: "scss",
    sh: "bash",
    bash: "bash",
    sql: "sql",
    xml: "xml",
  };
  return langMap[ext || ""] || "plaintext";
}

/** Get file icon based on extension */
function FileTypeIcon({ filename, className }: { filename: string; className?: string }) {
  const ext = filename.split(".").pop()?.toLowerCase();

  // Simple color coding based on file type
  let color = "text-text-muted";
  if (["js", "ts", "jsx", "tsx"].includes(ext || "")) color = "text-neon-yellow";
  else if (["md", "txt"].includes(ext || "")) color = "text-neon-cyan";
  else if (["json", "yaml", "yml"].includes(ext || "")) color = "text-neon-magenta";
  else if (["py", "rb"].includes(ext || "")) color = "text-neon-green";

  return (
    <svg className={`${className} ${color}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}

interface TabBarProps {
  tabs: EditorTab[];
  activeTabId: string;
  onTabChange: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
}

function TabBar({ tabs, activeTabId, onTabChange, onTabClose }: TabBarProps) {
  return (
    <div className="flex items-center border-b border-neon-cyan/10 bg-bg-surface/50 overflow-x-auto">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            className={`
              group flex items-center gap-2 px-3 py-2 border-r border-neon-cyan/10
              cursor-pointer transition-colors
              ${isActive
                ? "bg-bg-deep text-text-primary border-b-2 border-b-neon-cyan"
                : "text-text-muted hover:bg-bg-elevated hover:text-text-primary"
              }
            `}
            onClick={() => onTabChange(tab.id)}
          >
            <FileTypeIcon filename={tab.name} className="h-4 w-4 shrink-0" />
            <span className="font-mono text-sm whitespace-nowrap">{tab.name}</span>
            {tab.isModified && (
              <span className="h-2 w-2 rounded-full bg-neon-yellow shrink-0" title="Unsaved changes" />
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onTabClose(tab.id);
              }}
              className={`
                p-0.5 rounded opacity-0 group-hover:opacity-100
                hover:bg-neon-red/20 hover:text-neon-red
                transition-all cursor-pointer
                ${isActive ? "opacity-100" : ""}
              `}
            >
              <CloseIcon className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

interface TextAreaEditorProps {
  content: string;
  onChange: (content: string) => void;
  onSave?: () => void;
  language?: string;
  readOnly?: boolean;
}

function TextAreaEditor({ content, onChange, onSave, readOnly }: TextAreaEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);

  // Calculate line numbers
  const lines = content.split("\n");
  const lineCount = lines.length;

  // Sync scroll between textarea and line numbers
  const handleScroll = useCallback(() => {
    if (textareaRef.current && lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  }, []);

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Ctrl/Cmd + S to save
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        onSave?.();
      }

      // Tab to indent
      if (e.key === "Tab") {
        e.preventDefault();
        const textarea = textareaRef.current;
        if (textarea) {
          const start = textarea.selectionStart;
          const end = textarea.selectionEnd;
          const newContent = content.substring(0, start) + "  " + content.substring(end);
          onChange(newContent);
          // Move cursor after the tab
          setTimeout(() => {
            textarea.selectionStart = textarea.selectionEnd = start + 2;
          }, 0);
        }
      }
    },
    [content, onChange, onSave]
  );

  return (
    <div className="flex h-full">
      {/* Line numbers */}
      <div
        ref={lineNumbersRef}
        className="shrink-0 w-12 py-4 pr-2 text-right border-r border-neon-cyan/10 bg-bg-surface/30 overflow-hidden select-none"
      >
        {Array.from({ length: lineCount }).map((_, i) => (
          <div
            key={i}
            className="font-mono text-xs text-text-muted/50 leading-6 h-6"
          >
            {i + 1}
          </div>
        ))}
      </div>

      {/* Editor */}
      <textarea
        ref={textareaRef}
        value={content}
        onChange={(e) => onChange(e.target.value)}
        onScroll={handleScroll}
        onKeyDown={handleKeyDown}
        readOnly={readOnly}
        spellCheck={false}
        className={`
          flex-1 w-full h-full p-4
          bg-transparent text-text-primary
          font-mono text-sm leading-6
          resize-none focus:outline-none
          ${readOnly ? "cursor-not-allowed opacity-75" : ""}
        `}
        placeholder="Start typing..."
      />
    </div>
  );
}

export function CodeEditor({
  tabs,
  activeTabId,
  onTabChange,
  onTabClose,
  onContentChange,
  onSave,
  readOnly = false,
  className = "",
}: CodeEditorProps) {
  const activeTab = tabs.find((t) => t.id === activeTabId);

  return (
    <div className={`flex flex-col h-full bg-bg-deep ${className}`}>
      {/* Tab bar */}
      {tabs.length > 0 && (
        <TabBar
          tabs={tabs}
          activeTabId={activeTabId}
          onTabChange={onTabChange}
          onTabClose={onTabClose}
        />
      )}

      {/* Editor content */}
      <div className="flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          {activeTab ? (
            <motion.div
              key={activeTab.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.1 }}
              className="h-full"
            >
              <TextAreaEditor
                content={activeTab.content}
                onChange={(content) => onContentChange(activeTab.id, content)}
                onSave={() => onSave?.(activeTab.id)}
                language={activeTab.language || getLanguageFromFilename(activeTab.name)}
                readOnly={readOnly}
              />
            </motion.div>
          ) : (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-center justify-center h-full"
            >
              <div className="text-center">
                <p className="font-body text-lg text-text-muted mb-2">
                  No file open
                </p>
                <p className="font-body text-sm text-text-muted/70">
                  Select a file from the tree to edit
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Status bar */}
      {activeTab && (
        <div className="flex items-center justify-between px-4 py-1.5 border-t border-neon-cyan/10 bg-bg-surface/50">
          <div className="flex items-center gap-4">
            <span className="font-mono text-xs text-text-muted">
              {activeTab.language || getLanguageFromFilename(activeTab.name)}
            </span>
            <span className="font-mono text-xs text-text-muted">
              {activeTab.content.split("\n").length} lines
            </span>
          </div>
          <div className="flex items-center gap-2">
            {activeTab.isModified && (
              <span className="font-mono text-xs text-neon-yellow">Modified</span>
            )}
            {onSave && (
              <span className="font-mono text-xs text-text-muted/50">
                {navigator.platform.includes("Mac") ? "Cmd" : "Ctrl"}+S to save
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Hook to manage editor state.
 * Handles tabs, content changes, and file operations.
 */
export function useEditorState(_initialFiles: { id: string; name: string; content: string }[] = []) {
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>("");

  const openFile = useCallback((file: { id: string; name: string; content: string }) => {
    setTabs((prev) => {
      const existing = prev.find((t) => t.id === file.id);
      if (existing) {
        setActiveTabId(file.id);
        return prev;
      }
      return [...prev, { ...file, isModified: false }];
    });
    setActiveTabId(file.id);
  }, []);

  const closeTab = useCallback((tabId: string) => {
    setTabs((prev) => {
      const newTabs = prev.filter((t) => t.id !== tabId);
      if (activeTabId === tabId && newTabs.length > 0) {
        setActiveTabId(newTabs[newTabs.length - 1].id);
      } else if (newTabs.length === 0) {
        setActiveTabId("");
      }
      return newTabs;
    });
  }, [activeTabId]);

  const updateContent = useCallback((tabId: string, content: string) => {
    setTabs((prev) =>
      prev.map((t) =>
        t.id === tabId ? { ...t, content, isModified: true } : t
      )
    );
  }, []);

  const markSaved = useCallback((tabId: string) => {
    setTabs((prev) =>
      prev.map((t) =>
        t.id === tabId ? { ...t, isModified: false } : t
      )
    );
  }, []);

  const getContent = useCallback((tabId: string) => {
    return tabs.find((t) => t.id === tabId)?.content || "";
  }, [tabs]);

  return {
    tabs,
    activeTabId,
    setActiveTabId,
    openFile,
    closeTab,
    updateContent,
    markSaved,
    getContent,
  };
}
