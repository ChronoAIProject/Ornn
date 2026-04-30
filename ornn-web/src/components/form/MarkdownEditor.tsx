/**
 * Markdown Editor Component.
 * Simple textarea-based markdown editor with preview.
 * Forge Workshop styled with neon accents.
 * @module components/form/MarkdownEditor
 */

import { useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import rehypeHighlight from "rehype-highlight";

export interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  error?: string;
  /** Minimum rows for textarea */
  minRows?: number;
  /** Maximum rows for textarea */
  maxRows?: number;
  /** Whether to show preview toggle */
  showPreview?: boolean;
  /** Additional CSS classes */
  className?: string;
}

/** Bold icon */
function BoldIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 4h8a4 4 0 014 4 4 4 0 01-4 4H6z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 12h9a4 4 0 014 4 4 4 0 01-4 4H6z" />
    </svg>
  );
}

/** Italic icon */
function ItalicIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 4h4m0 16h-4m5-16l-6 16" />
    </svg>
  );
}

/** Code icon */
function CodeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
    </svg>
  );
}

/** Link icon */
function LinkIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
    </svg>
  );
}

/** List icon */
function ListIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
    </svg>
  );
}

/** Heading icon */
function HeadingIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4v16M17 4v16M7 12h10" />
    </svg>
  );
}

/** Preview icon */
function PreviewIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  );
}

/** Edit icon */
function EditIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
    </svg>
  );
}

interface ToolbarButton {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  action: (textarea: HTMLTextAreaElement, value: string, onChange: (v: string) => void) => void;
}

const TOOLBAR_BUTTONS: ToolbarButton[] = [
  {
    icon: HeadingIcon,
    label: "Heading",
    action: (ta, value, onChange) => insertAtCursor(ta, value, onChange, "## ", ""),
  },
  {
    icon: BoldIcon,
    label: "Bold",
    action: (ta, value, onChange) => wrapSelection(ta, value, onChange, "**", "**"),
  },
  {
    icon: ItalicIcon,
    label: "Italic",
    action: (ta, value, onChange) => wrapSelection(ta, value, onChange, "_", "_"),
  },
  {
    icon: CodeIcon,
    label: "Code",
    action: (ta, value, onChange) => {
      const selection = ta.value.substring(ta.selectionStart, ta.selectionEnd);
      if (selection.includes("\n")) {
        wrapSelection(ta, value, onChange, "```\n", "\n```");
      } else {
        wrapSelection(ta, value, onChange, "`", "`");
      }
    },
  },
  {
    icon: LinkIcon,
    label: "Link",
    action: (ta, value, onChange) => {
      const selection = ta.value.substring(ta.selectionStart, ta.selectionEnd);
      if (selection) {
        wrapSelection(ta, value, onChange, "[", "](url)");
      } else {
        insertAtCursor(ta, value, onChange, "[link text](url)", "");
      }
    },
  },
  {
    icon: ListIcon,
    label: "List",
    action: (ta, value, onChange) => insertAtCursor(ta, value, onChange, "- ", ""),
  },
];

function insertAtCursor(
  textarea: HTMLTextAreaElement,
  value: string,
  onChange: (v: string) => void,
  before: string,
  after: string
) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const newValue = value.substring(0, start) + before + after + value.substring(end);
  onChange(newValue);
  // Set cursor position after the inserted text
  setTimeout(() => {
    textarea.selectionStart = textarea.selectionEnd = start + before.length;
    textarea.focus();
  }, 0);
}

function wrapSelection(
  textarea: HTMLTextAreaElement,
  value: string,
  onChange: (v: string) => void,
  before: string,
  after: string
) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selection = value.substring(start, end);
  const newValue = value.substring(0, start) + before + selection + after + value.substring(end);
  onChange(newValue);
  // Keep selection around the wrapped text
  setTimeout(() => {
    textarea.selectionStart = start + before.length;
    textarea.selectionEnd = end + before.length;
    textarea.focus();
  }, 0);
}

export function MarkdownEditor({
  value,
  onChange,
  placeholder = "Write your markdown here...",
  label,
  error,
  minRows = 10,
  maxRows = 30,
  showPreview = true,
  className = "",
}: MarkdownEditorProps) {
  const [isPreview, setIsPreview] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleToolbarClick = useCallback(
    (button: ToolbarButton) => {
      if (textareaRef.current) {
        button.action(textareaRef.current, value, onChange);
      }
    },
    [value, onChange]
  );

  return (
    <div className={`space-y-2 ${className}`}>
      {/* Label */}
      {label && (
        <label className="block font-display text-xs uppercase tracking-wider text-meta">
          {label}
        </label>
      )}

      {/* Editor container */}
      <div className="rounded border border-accent/20 bg-page overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center justify-between border-b border-accent/10 px-2 py-1.5 bg-card/50">
          {/* Formatting buttons */}
          <div className="flex items-center gap-0.5">
            {TOOLBAR_BUTTONS.map((button) => {
              const Icon = button.icon;
              return (
                <button
                  key={button.label}
                  type="button"
                  onClick={() => handleToolbarClick(button)}
                  disabled={isPreview}
                  className="p-1.5 rounded text-meta hover:text-accent hover:bg-accent/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  title={button.label}
                >
                  <Icon className="h-4 w-4" />
                </button>
              );
            })}
          </div>

          {/* Preview toggle */}
          {showPreview && (
            <button
              type="button"
              onClick={() => setIsPreview(!isPreview)}
              className={`
                flex items-center gap-1.5 px-2 py-1 rounded text-sm font-text
                transition-colors cursor-pointer
                ${isPreview
                  ? "text-accent bg-accent/10"
                  : "text-meta hover:text-strong"
                }
              `}
            >
              {isPreview ? (
                <>
                  <EditIcon className="h-4 w-4" />
                  <span className="hidden sm:inline">Edit</span>
                </>
              ) : (
                <>
                  <PreviewIcon className="h-4 w-4" />
                  <span className="hidden sm:inline">Preview</span>
                </>
              )}
            </button>
          )}
        </div>

        {/* Content area */}
        <AnimatePresence mode="wait">
          {isPreview ? (
            <motion.div
              key="preview"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="p-4 min-h-[250px] max-h-[500px] overflow-y-auto"
            >
              {value ? (
                <div className="markdown-body">
                  <Markdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeSanitize, rehypeHighlight]}
                  >
                    {value}
                  </Markdown>
                </div>
              ) : (
                <p className="text-meta font-text text-sm italic">
                  Nothing to preview yet...
                </p>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="editor"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <textarea
                ref={textareaRef}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                rows={minRows}
                className="w-full bg-transparent px-4 py-3 font-mono text-sm text-strong placeholder:text-meta/50 resize-y focus:outline-none"
                style={{
                  minHeight: `${minRows * 1.5}rem`,
                  maxHeight: `${maxRows * 1.5}rem`,
                }}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Error message */}
      {error && (
        <p className="text-xs text-danger font-text">{error}</p>
      )}

      {/* Help text */}
      <p className="text-xs text-meta font-text">
        Supports Markdown formatting. Use **bold**, _italic_, `code`, and more.
      </p>
    </div>
  );
}
