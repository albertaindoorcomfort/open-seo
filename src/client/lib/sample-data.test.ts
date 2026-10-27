import { QueryClient, QueryObserver } from "@tanstack/query-core";
import { describe, expect, it } from "vitest";
import type { DataforseoAnswer } from "@/server/lib/dataforseo/sample-scope";
import { createSampleAnswerTracker } from "./sample-data";

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { gcTime: Infinity } },
  });
  const tracker = createSampleAnswerTracker(client.getQueryCache());
  return {
    client,
    tracker,
    /** Fetches `key` through a server function that got `answer`. */
    fetch: (key: string, answer: DataforseoAnswer) =>
      client.fetchQuery({
        queryKey: [key],
        queryFn: async () => {
          tracker.noteAnswer(answer);
          return { rows: [] };
        },
      }),
    /** Puts `key` on screen; returns the unmount. */
    show: (key: string) =>
      new QueryObserver(client, { queryKey: [key], enabled: false }).subscribe(
        () => {},
      ),
  };
}

describe("sample data banner", () => {
  it("stays on while a query on screen holds sample data, whatever other queries answer", async () => {
    const { tracker, fetch, show } = setup();
    await fetch("research", "credits");
    show("research");
    await fetch("domain", "live");
    show("domain");

    expect(tracker.reason()).toBe("credits");
  });

  it("clears once that query refetches live", async () => {
    const { tracker, fetch, show } = setup();
    await fetch("research", "credits");
    show("research");
    await fetch("research", "live");

    expect(tracker.reason()).toBeNull();
  });

  it("clears when that query leaves the cache", async () => {
    const { client, tracker, fetch, show } = setup();
    await fetch("research", "credits");
    show("research");
    client.removeQueries({ queryKey: ["research"] });

    expect(tracker.reason()).toBeNull();
  });

  it("is off while that query is off screen, and on again when it returns", async () => {
    const { tracker, fetch, show } = setup();
    await fetch("research", "credits");
    const unmount = show("research");
    unmount();
    expect(tracker.reason()).toBeNull();

    show("research");
    expect(tracker.reason()).toBe("credits");
  });
});
