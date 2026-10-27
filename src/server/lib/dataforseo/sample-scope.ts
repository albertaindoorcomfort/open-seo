// Whether DataForSEO answered with sample data is recorded per scope, never
// per process. A scope opens for each server function call (the sample-data
// middleware, which also tells that browser's banner) and around each call
// whose result may be stored. Nothing is shared between requests, so one
// organisation's refusal can never flip the banner or the caching for another.
//
// Outside any scope (MCP, agents, workflows) only a missing key answers with
// sample data, and inDataforseoSampleMode() falls back to the key check there.
//
// Kept apart from sample.ts so the middleware can open a scope without loading
// the sample generators.

import { AsyncLocalStorage } from "node:async_hooks";

export type SampleReason = "no_key" | "auth" | "credits" | "quota";
export type DataforseoAnswer = SampleReason | "live";

// What DataForSEO answered inside one scope: null before any call, "live", or
// why a call answered with sample data.
type SampleScope = {
  answer: DataforseoAnswer | null;
  parent: SampleScope | undefined;
};

const sampleScopes = new AsyncLocalStorage<SampleScope>();

/**
 * Runs `fn` in its own scope and reports what DataForSEO answered inside it:
 * `answer` is null when no call was made, `sample` is the reason when any call
 * answered with sample data.
 */
export async function trackDataforseoSample<T>(fn: () => Promise<T>): Promise<{
  value: T;
  answer: DataforseoAnswer | null;
  sample: SampleReason | null;
}> {
  const scope: SampleScope = { answer: null, parent: sampleScopes.getStore() };
  const value = await sampleScopes.run(scope, fn);
  const { answer } = scope;
  return { value, answer, sample: answer === "live" ? null : answer };
}

/** True inside a scope. Outside one (MCP, agents, workflows) a refusal cannot be labelled. */
export function inDataforseoSampleScope(): boolean {
  return sampleScopes.getStore() !== undefined;
}

/** Records an answer in the current scope and every scope around it. */
export function recordDataforseoAnswer(answer: DataforseoAnswer): void {
  for (let scope = sampleScopes.getStore(); scope; scope = scope.parent) {
    // The first sample reason sticks, so a scope that mixed live and sample
    // answers is never treated as all real.
    if (scope.answer === null || scope.answer === "live") scope.answer = answer;
  }
}

/** Why a DataForSEO call in the current scope answered with sample data (null when none did). */
export function dataforseoSampleReason(): SampleReason | null {
  const answer = sampleScopes.getStore()?.answer ?? null;
  return answer === "live" ? null : answer;
}
