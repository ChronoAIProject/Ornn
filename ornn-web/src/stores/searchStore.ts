import { create } from "zustand";

interface SearchState {
  query: string;
  mode: "keyword" | "semantic";
  scope: "public" | "private" | "mixed";
  page: number;
  pageSize: number;
  setQuery: (q: string) => void;
  setMode: (m: "keyword" | "semantic") => void;
  setScope: (s: "public" | "private" | "mixed") => void;
  setPage: (p: number) => void;
  setPageSize: (ps: number) => void;
  reset: () => void;
}

const initialState = {
  query: "",
  mode: "keyword" as const,
  scope: "public" as const,
  page: 1,
  pageSize: 20,
};

export const useSearchStore = create<SearchState>((set) => ({
  ...initialState,
  setQuery: (query) => set({ query, page: 1 }),
  setMode: (mode) => set({ mode, page: 1 }),
  setScope: (scope) => set({ scope, page: 1 }),
  setPage: (page) => set({ page }),
  setPageSize: (pageSize) => set({ pageSize, page: 1 }),
  reset: () => set(initialState),
}));
