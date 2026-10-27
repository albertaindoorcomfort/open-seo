import { useSyncExternalStore } from "react";
import type { QueryCache } from "@tanstack/query-core";
import { queryClient } from "@/client/tanstack-db/queryClient";
import type {
  DataforseoAnswer,
  SampleReason,
} from "@/server/lib/dataforseo/sample-scope";

// The "Sample data" banner stays on while any query on screen holds data that
// came from a sample answer, however many live answers arrive for other
// queries. Each server function answer (src/middleware/sampleData.ts) is
// credited to every query fetching at that moment: a browser cannot tell which
// call belongs to which query, so a live query fetching beside a sample one is
// marked too (the banner errs towards showing). A query's mark is replaced each
// time it fetches, and dropped when it leaves the cache. All of this lives in
// this browser only, so another user's refusal never reaches this banner.

/** Tracks which cached queries hold sample data, for one query cache. */
export function createSampleAnswerTracker(queryCache: QueryCache) {
  // Keyed by query hash. What each fetch in flight has been answered so far
  // (null: no DataForSEO call), and the reason of each query holding sample data.
  const heard = new Map<string, DataforseoAnswer | null>();
  const marked = new Map<string, SampleReason>();
  const listeners = new Set<() => void>();

  const stop = queryCache.subscribe((event) => {
    const hash = event.query.queryHash;
    if (event.type === "removed") {
      heard.delete(hash);
      marked.delete(hash);
    } else if (event.type === "updated") {
      const { action } = event;
      if (action.type === "fetch") {
        heard.set(hash, null);
        return;
      }
      if (action.type === "error") {
        // The data on screen is still the earlier answer, so its mark stays.
        heard.delete(hash);
        return;
      }
      if (action.type !== "success" || action.manual) return;
      const answer = heard.get(hash) ?? null;
      heard.delete(hash);
      // No DataForSEO call means the data came from storage, which never
      // holds sample data.
      if (answer === null || answer === "live") marked.delete(hash);
      else marked.set(hash, answer);
    } else if (
      event.type !== "observerAdded" &&
      event.type !== "observerRemoved"
    ) {
      return;
    }
    for (const listener of listeners) listener();
  });

  return {
    /** Credits a server function's answer to every query fetching now. */
    noteAnswer(answer: DataforseoAnswer | null | undefined): void {
      // null: the server function made no DataForSEO call.
      if (answer == null) return;
      for (const [hash, earlier] of heard) {
        if (queryCache.get(hash)?.state.fetchStatus !== "fetching") continue;
        // The first sample reason sticks, as in the server's scope.
        if (earlier === null || earlier === "live") heard.set(hash, answer);
      }
    },
    /** Why a query on screen holds sample data, or null when none does. */
    reason(): SampleReason | null {
      for (const [hash, reason] of marked) {
        if ((queryCache.get(hash)?.getObserversCount() ?? 0) > 0) return reason;
      }
      return null;
    },
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    stop,
  };
}

// On the server (SSR) nothing is kept: this state belongs to one browser.
const tracker =
  typeof window === "undefined"
    ? null
    : createSampleAnswerTracker(queryClient.getQueryCache());

export function noteDataforseoAnswer(
  answer: DataforseoAnswer | null | undefined,
): void {
  tracker?.noteAnswer(answer);
}

const noSubscription = () => () => {};

/** Why data on screen in this browser came from a sample answer, or null. */
export function useResponseSampleReason(): SampleReason | null {
  return useSyncExternalStore(
    tracker?.subscribe ?? noSubscription,
    () => tracker?.reason() ?? null,
    () => null,
  );
}
