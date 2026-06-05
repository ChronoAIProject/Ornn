/**
 * `useEditorState` hook, split out of CodeEditor.tsx so the component
 * file only exports components — required for react-refresh / Fast
 * Refresh (#888).
 *
 * @module components/editor/CodeEditor.helpers
 */

import { useState, useCallback } from "react";
import type { EditorTab } from "./CodeEditor";

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
        // Length-guarded above — newTabs.length > 0 means index
        // length-1 is valid. `!` is safe under noUncheckedIndexedAccess
        // (#450).
        setActiveTabId(newTabs[newTabs.length - 1]!.id);
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
