/**
 * UsagePullsCard tests — the render-time frame-commit identity guard (#888).
 *
 * The card commits its drawn `frame` with the "adjust state during render"
 * pattern instead of an effect:
 *
 *   if (!isFetching && items && (frame === null || frame.items !== items ||
 *       frame.bucket !== bucket || frame.from !== from || frame.to !== to)) {
 *     setFrame(...);
 *   }
 *
 * The `frame.items !== items` identity check is load-bearing — with
 * `keepPreviousData` the hook hands back a STABLE `items` reference across
 * rerenders, so once a frame is committed the predicate goes false and the
 * render-phase `setFrame` stops firing. If that guard regressed (e.g.
 * compared by value, or dropped the items check) every render would queue
 * another `setFrame`, an unbounded render loop.
 *
 * We assert that by counting renders: a stable `items` array, poked through
 * several rerenders, must NOT keep climbing the render count unboundedly.
 * A second case proves the guard still SWAPS the frame when `items` identity
 * changes and the query has settled (`!isFetching`).
 *
 * The query hook is mocked at its seam (`@/hooks/useAnalytics`) so the test
 * never touches the apiClient / TanStack Query runtime.
 *
 * @module components/skill/UsagePullsCard.test
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Profiler, type ReactNode } from "react";
import type { PullBucketCount } from "@/types/analytics";

interface PullsHookState {
  data: PullBucketCount[] | undefined;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
}

const pullsState: PullsHookState = {
  data: undefined,
  isLoading: false,
  isError: false,
  isFetching: false,
};

const useSkillPulls = vi.fn(() => pullsState);

vi.mock("@/hooks/useAnalytics", () => ({
  useSkillPulls: () => useSkillPulls(),
}));

// recharts needs a non-zero layout box; ResponsiveContainer reads
// clientWidth/clientHeight, both 0 in jsdom. Stub it to a plain pass-through
// so the chart actually mounts (otherwise it renders nothing and the test
// can't see "no crash, content stable").
vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactNode }) => (
      <div style={{ width: 600, height: 256 }}>{children}</div>
    ),
  };
});

import { UsagePullsCard } from "./UsagePullsCard";

const STABLE_ITEMS: PullBucketCount[] = [
  {
    bucket: "2026-06-05T00:00:00.000Z",
    total: 5,
    bySource: { api: 3, web: 1, playground: 1 },
  },
  {
    bucket: "2026-06-05T01:00:00.000Z",
    total: 2,
    bySource: { api: 1, web: 1, playground: 0 },
  },
];

beforeEach(() => {
  // Pin the clock. UsagePullsCard derives its visible window from `now`
  // (`rangeFor` → hour = last 24h), then `rowsFor` only sums fixture
  // buckets that land inside that window. The fixtures below are dated
  // 2026-06-05, so a real `now` walks them out of the 24h window within a
  // day and every bucket pads to 0 — the totals strip reads 0/0/0 and the
  // "api = 4" assertion fails. Faking only `Date` (timers stay real so
  // React/recharts scheduling is untouched) keeps the window deterministic.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-06-05T02:00:00.000Z"));
  useSkillPulls.mockClear();
  pullsState.data = undefined;
  pullsState.isLoading = false;
  pullsState.isError = false;
  pullsState.isFetching = false;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("UsagePullsCard — frame-commit identity guard", () => {
  it("does not loop setFrame when items identity is stable across rerenders", () => {
    // Same array reference every render — the keepPreviousData contract.
    pullsState.data = STABLE_ITEMS;
    pullsState.isFetching = false;

    let renders = 0;
    const onRender = () => {
      renders += 1;
    };

    const { rerender } = render(
      <Profiler id="usage" onRender={onRender}>
        <UsagePullsCard idOrName="skill-1" />
      </Profiler>,
    );

    // First render commits exactly one frame, which triggers one extra
    // render-phase update — React's render-during-render is bounded, not a
    // loop, because the predicate goes false once `frame.items === items`.
    const rendersAfterMount = renders;

    // The totals strip reflects the committed frame: api=4, web=2, pg=1.
    expect(screen.getByText("4")).toBeInTheDocument(); // api
    expect(screen.getByText("2")).toBeInTheDocument(); // web

    // Poke the component with several no-op rerenders (stable items).
    for (let i = 0; i < 5; i++) {
      rerender(
        <Profiler id="usage" onRender={onRender}>
          <UsagePullsCard idOrName="skill-1" />
        </Profiler>,
      );
    }

    // Each poke is at most a small constant number of renders — never an
    // unbounded climb. 5 pokes against a stable frame stay well under a
    // generous ceiling; an unbounded setFrame loop would blow past it.
    const rendersFromPokes = renders - rendersAfterMount;
    expect(rendersFromPokes).toBeLessThanOrEqual(10);

    // Frame content is stable — the totals strip still reads the same.
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("swaps the committed frame when items identity changes and the query has settled", () => {
    pullsState.data = STABLE_ITEMS;
    pullsState.isFetching = false;

    const { rerender } = render(<UsagePullsCard idOrName="skill-1" />);

    // Initial totals: api=4, web=2.
    expect(screen.getByText("4")).toBeInTheDocument();

    // New items identity + settled query → frame must re-commit.
    const NEXT_ITEMS: PullBucketCount[] = [
      {
        bucket: "2026-06-05T00:00:00.000Z",
        total: 20,
        bySource: { api: 10, web: 7, playground: 3 },
      },
    ];
    pullsState.data = NEXT_ITEMS;
    pullsState.isFetching = false;

    rerender(<UsagePullsCard idOrName="skill-1" />);

    // Totals now reflect the swapped frame: api=10, web=7, pg=3.
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    // The old api total (4) is gone.
    expect(screen.queryByText("4")).not.toBeInTheDocument();
  });
});
