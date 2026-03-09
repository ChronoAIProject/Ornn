/**
 * Skill Generation Hook.
 * Manages the generation lifecycle for the generative mode.
 * Handles streaming, token batching, file parsing, and multi-turn conversation history.
 * @module hooks/useSkillGeneration
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { generateSkillStream } from "@/services/generateStreamApi";
import { parseGenerationOutput } from "@/utils/generationParser";
import type { GenerationStreamEvent } from "@/types/streaming";
import type { GenerationPhase, SkillMetadata } from "@/types/skillPackage";
import type { FileNode } from "@/components/editor/FileTree";

/** Minimum interval (ms) between token state flushes */
const TOKEN_FLUSH_INTERVAL_MS = 50;

export interface ChatDisplayMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
  skillName?: string;
  skillDescription?: string;
}

interface GenerationState {
  phase: GenerationPhase;
  chatMessages: ChatDisplayMessage[];
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>;
  streamingTokens: string;
  parsedFiles: FileNode[];
  fileContents: Map<string, string>;
  metadata: SkillMetadata | null;
  error: string | null;
}

export interface UseSkillGenerationReturn extends GenerationState {
  /** Send a message (user prompt) to the generation stream */
  sendMessage: (content: string) => void;
  /** Abort current stream */
  abort: () => void;
  /** Reset to input phase */
  reset: () => void;
  /** Update file content (manual editing) */
  updateFileContent: (fileId: string, content: string) => void;
  /** Delete a file from the preview */
  deleteFile: (fileId: string) => void;
  /** Add an uploaded file */
  addFile: (folder: string, file: File) => void;
}

const INITIAL_STATE: GenerationState = {
  phase: "input",
  chatMessages: [],
  conversationHistory: [],
  streamingTokens: "",
  parsedFiles: [],
  fileContents: new Map(),
  metadata: null,
  error: null,
};

/**
 * Hook managing the generation/refinement lifecycle with token batching
 * and multi-turn chat support.
 */
export function useSkillGeneration(): UseSkillGenerationReturn {
  const [state, setState] = useState<GenerationState>(INITIAL_STATE);
  const abortRef = useRef<(() => void) | null>(null);
  const tokenBufferRef = useRef("");
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const assistantMsgIdRef = useRef("");
  /** Ref mirror of conversationHistory so sendMessage can read it synchronously. */
  const conversationHistoryRef = useRef<Array<{ role: "user" | "assistant"; content: string }>>([]);

  const flushTokenBuffer = useCallback(() => {
    flushTimerRef.current = null;
    const buffered = tokenBufferRef.current;
    if (!buffered) return;
    tokenBufferRef.current = "";
    setState((prev) => {
      const messages = [...prev.chatMessages];
      const lastIdx = messages.length - 1;
      if (lastIdx >= 0 && messages[lastIdx].role === "assistant" && messages[lastIdx].isStreaming) {
        messages[lastIdx] = {
          ...messages[lastIdx],
          content: messages[lastIdx].content + buffered,
        };
      }
      return {
        ...prev,
        streamingTokens: prev.streamingTokens + buffered,
        chatMessages: messages,
      };
    });
  }, []);

  const cancelFlush = useCallback(() => {
    if (flushTimerRef.current !== null) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
  }, []);

  const handleEvent = useCallback(
    (event: GenerationStreamEvent) => {
      if (event.type === "token") {
        tokenBufferRef.current += event.content;
        if (flushTimerRef.current === null) {
          flushTimerRef.current = setTimeout(
            flushTokenBuffer,
            TOKEN_FLUSH_INTERVAL_MS,
          );
        }
        return;
      }

      // Non-token events: flush pending tokens first
      cancelFlush();
      const buffered = tokenBufferRef.current;
      tokenBufferRef.current = "";

      switch (event.type) {
        case "generation_start":
          setState((prev) => {
            const messages = [...prev.chatMessages];
            const lastIdx = messages.length - 1;
            if (lastIdx >= 0 && messages[lastIdx].role === "assistant" && messages[lastIdx].isStreaming) {
              messages[lastIdx] = {
                ...messages[lastIdx],
                content: messages[lastIdx].content + buffered,
              };
            }
            return {
              ...prev,
              phase: "generating",
              streamingTokens: prev.streamingTokens + buffered,
              chatMessages: messages,
            };
          });
          break;

        case "generation_complete": {
          const { files, contents, metadata } = parseGenerationOutput(
            event.raw,
          );
          const currentAssistantId = assistantMsgIdRef.current;
          // Update ref synchronously before setState
          conversationHistoryRef.current = [
            ...conversationHistoryRef.current,
            { role: "assistant" as const, content: event.raw },
          ];
          setState((prev) => {
            const messages = prev.chatMessages.map((msg) => {
              if (msg.id === currentAssistantId) {
                const summary = metadata?.name
                  ? `Generated skill: ${metadata.name}`
                  : "Skill generation complete";
                return {
                  ...msg,
                  content: summary,
                  isStreaming: false,
                  skillName: metadata?.name,
                  skillDescription: metadata?.description,
                };
              }
              return msg;
            });
            return {
              ...prev,
              phase: "preview",
              streamingTokens: prev.streamingTokens + buffered,
              parsedFiles: files,
              fileContents: contents,
              metadata,
              conversationHistory: conversationHistoryRef.current,
              chatMessages: messages,
            };
          });
          break;
        }

        case "validation_error":
          setState((prev) => {
            const messages = [...prev.chatMessages];
            const lastIdx = messages.length - 1;
            if (lastIdx >= 0 && messages[lastIdx].role === "assistant" && messages[lastIdx].isStreaming) {
              messages[lastIdx] = {
                ...messages[lastIdx],
                content: messages[lastIdx].content + buffered,
              };
            }
            return {
              ...prev,
              streamingTokens: prev.streamingTokens + buffered,
              chatMessages: messages,
            };
          });
          break;

        case "error": {
          const currentAssistantId = assistantMsgIdRef.current;
          setState((prev) => {
            const messages = prev.chatMessages.map((msg) => {
              if (msg.id === currentAssistantId && msg.isStreaming) {
                return {
                  ...msg,
                  content: `Error: ${event.message}`,
                  isStreaming: false,
                };
              }
              return msg;
            });
            return {
              ...prev,
              phase: "error",
              error: event.message,
              streamingTokens: prev.streamingTokens + buffered,
              chatMessages: messages,
            };
          });
          break;
        }
      }
    },
    [flushTokenBuffer, cancelFlush],
  );

  const abort = useCallback(() => {
    abortRef.current?.();
    abortRef.current = null;
    cancelFlush();
    const remaining = tokenBufferRef.current;
    tokenBufferRef.current = "";
    const currentAssistantId = assistantMsgIdRef.current;
    setState((prev) => {
      const messages = prev.chatMessages.map((msg) => {
        if (msg.id === currentAssistantId && msg.isStreaming) {
          return {
            ...msg,
            content: msg.content + remaining,
            isStreaming: false,
          };
        }
        return msg;
      });
      return {
        ...prev,
        streamingTokens: prev.streamingTokens + remaining,
        chatMessages: messages,
      };
    });
  }, [cancelFlush]);

  const sendMessage = useCallback(
    (content: string) => {
      abort();
      tokenBufferRef.current = "";

      const userMsgId = crypto.randomUUID();
      const assistantMsgId = crypto.randomUUID();
      assistantMsgIdRef.current = assistantMsgId;

      const userMessage: ChatDisplayMessage = {
        id: userMsgId,
        role: "user",
        content,
      };

      const assistantMessage: ChatDisplayMessage = {
        id: assistantMsgId,
        role: "assistant",
        content: "",
        isStreaming: true,
      };

      // Build conversation history from ref (synchronous, immune to React 18 batching)
      const messagesForApi = [
        ...conversationHistoryRef.current,
        { role: "user" as const, content },
      ];
      conversationHistoryRef.current = messagesForApi;

      setState((prev) => ({
        ...prev,
        phase: "generating",
        streamingTokens: "",
        chatMessages: [...prev.chatMessages, userMessage, assistantMessage],
        conversationHistory: messagesForApi,
        error: null,
      }));

      const handle = generateSkillStream(
        { messages: messagesForApi },
        handleEvent,
      );
      abortRef.current = handle.abort;
    },
    [abort, handleEvent],
  );

  const reset = useCallback(() => {
    abort();
    tokenBufferRef.current = "";
    assistantMsgIdRef.current = "";
    conversationHistoryRef.current = [];
    setState(INITIAL_STATE);
  }, [abort]);

  const updateFileContent = useCallback(
    (fileId: string, content: string) => {
      setState((prev) => {
        const newContents = new Map(prev.fileContents);
        newContents.set(fileId, content);
        return { ...prev, fileContents: newContents };
      });
    },
    [],
  );

  const deleteFile = useCallback((fileId: string) => {
    setState((prev) => {
      const newContents = new Map(prev.fileContents);
      newContents.delete(fileId);

      const removeFromTree = (nodes: FileNode[]): FileNode[] => {
        return nodes
          .filter((n) => n.id !== fileId)
          .map((n) => {
            if (n.children) {
              return { ...n, children: removeFromTree(n.children) };
            }
            return n;
          });
      };

      return {
        ...prev,
        fileContents: newContents,
        parsedFiles: removeFromTree(prev.parsedFiles),
      };
    });
  }, []);

  const addFile = useCallback((folder: string, file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const content = reader.result as string;
      const filePath = `${folder}/${file.name}`;

      setState((prev) => {
        const newContents = new Map(prev.fileContents);
        newContents.set(filePath, content);

        const newFiles = prev.parsedFiles.map((root) => {
          if (root.type !== "folder" || !root.children) return root;

          const existingFolder = root.children.find(
            (c) => c.id === folder && c.type === "folder",
          );

          if (existingFolder && existingFolder.children) {
            return {
              ...root,
              children: root.children.map((c) =>
                c.id === folder
                  ? {
                      ...c,
                      children: [
                        ...(c.children ?? []),
                        {
                          id: filePath,
                          name: file.name,
                          type: "file" as const,
                        },
                      ],
                    }
                  : c,
              ),
            };
          }

          return {
            ...root,
            children: [
              ...root.children,
              {
                id: folder,
                name: folder,
                type: "folder" as const,
                children: [
                  {
                    id: filePath,
                    name: file.name,
                    type: "file" as const,
                  },
                ],
              },
            ],
          };
        });

        return { ...prev, fileContents: newContents, parsedFiles: newFiles };
      });
    };
    reader.readAsText(file);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abort();
    };
  }, [abort]);

  return {
    ...state,
    sendMessage,
    abort,
    reset,
    updateFileContent,
    deleteFile,
    addFile,
  };
}
