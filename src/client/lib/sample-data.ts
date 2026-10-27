import { useSyncExternalStore } from "react";
import type {
  DataforseoAnswer,
  SampleReason,
} from "@/server/lib/dataforseo/sample-scope";

// The latest DataForSEO answer this browser received from a server function
// (src/middleware/sampleData.ts): a sample reason, or null once an answer came
// back live. It lives in this browser only, so another user's refusal never
// reaches this banner.
let latestSampleReason: SampleReason | null = null;
const listeners = new Set<() => void>();

export function noteDataforseoAnswer(
  answer: DataforseoAnswer | null | undefined,
): void {
  // null: the server function made no DataForSEO call, so nothing changed.
  // On the server (SSR) nothing is kept: this state belongs to one browser.
  if (answer == null || typeof window === "undefined") return;
  const reason = answer === "live" ? null : answer;
  if (reason === latestSampleReason) return;
  latestSampleReason = reason;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Why the latest DataForSEO-backed response in this browser was sample data, or null. */
export function useResponseSampleReason(): SampleReason | null {
  return useSyncExternalStore(
    subscribe,
    () => latestSampleReason,
    () => null,
  );
}
