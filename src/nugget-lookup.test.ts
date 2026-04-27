import { describe, expect, it } from "vitest";
import {
  appendNuggetLookupContextForAgent,
  parseChannelTaskCreateIntent,
  parseNuggetLookupIntent,
  parseRecurringScheduleIntent,
  parseTaskChannelTargetIntent,
  pickNuggetFieldsForAgent,
} from "./nugget-lookup.js";

describe("parseNuggetLookupIntent", () => {
  it("matches terse nugget id queries", () => {
    expect(parseNuggetLookupIntent("N111")).toEqual({ nuggetNumber: 111 });
    expect(parseNuggetLookupIntent("n222?")).toEqual({ nuggetNumber: 222 });
  });

  it("matches natural language nugget lookup text", () => {
    expect(parseNuggetLookupIntent("can you get info for nugget N333")).toEqual({
      nuggetNumber: 333,
    });
    expect(parseNuggetLookupIntent("show details for N444")).toEqual({
      nuggetNumber: 444,
    });
  });

  it("ignores unrelated text", () => {
    expect(parseNuggetLookupIntent("hello team")).toBeNull();
    expect(parseNuggetLookupIntent("nugget someday maybe")).toBeNull();
  });
});

describe("parseTaskChannelTargetIntent", () => {
  it("parses N/T style task targets", () => {
    expect(parseTaskChannelTargetIntent("N123")).toEqual({ nuggetNumber: 123, rawPrefix: "n" });
    expect(parseTaskChannelTargetIntent("t44")).toEqual({ nuggetNumber: 44, rawPrefix: "t" });
  });

  it("ignores non-target text", () => {
    expect(parseTaskChannelTargetIntent("room:123")).toBeNull();
    expect(parseTaskChannelTargetIntent("hello")).toBeNull();
  });
});

describe("parseChannelTaskCreateIntent", () => {
  it("extracts create task intent and defaults", () => {
    const parsed = parseChannelTaskCreateIntent("create task Fix production bug asap");
    expect(parsed).toEqual({
      kind: "task",
      title: "Fix production bug asap",
      description: "create task Fix production bug asap",
      priority: "urgent",
    });
  });

  it("returns null for non-create chatter", () => {
    expect(parseChannelTaskCreateIntent("task list please")).toBeNull();
  });
});

describe("parseRecurringScheduleIntent", () => {
  it("parses minute recurrence", () => {
    expect(parseRecurringScheduleIntent("every 5 minutes")).toEqual({ everyMinutes: 5 });
    expect(parseRecurringScheduleIntent("check every 15 min please")).toEqual({ everyMinutes: 15 });
  });

  it("parses hourly recurrence", () => {
    expect(parseRecurringScheduleIntent("hourly reminder")).toEqual({ everyMinutes: 60 });
  });

  it("returns null when recurrence is not specified", () => {
    expect(parseRecurringScheduleIntent("create a task for this")).toBeNull();
  });
});

describe("pickNuggetFieldsForAgent", () => {
  it("includes known fields and drops unknown keys", () => {
    const picked = pickNuggetFieldsForAgent({
      number: 111,
      title: "T",
      noise: "drop me",
      status: "open",
    } as Record<string, unknown>);
    expect(picked).toEqual({ number: 111, title: "T", status: "open" });
    expect(picked).not.toHaveProperty("noise");
  });
});

describe("appendNuggetLookupContextForAgent", () => {
  it("appends JSON payload when a record is found", () => {
    const out = appendNuggetLookupContextForAgent("What's N111?", 111, {
      number: 111,
      title: "Fix bug",
      status: "complete",
    });
    expect(out.startsWith("What's N111?")).toBe(true);
    expect(out.toLowerCase()).toContain("summarize for someone");
    expect(out).toContain('"number": 111');
    expect(out).toContain("Fix bug");
  });

  it("instructs the agent when nothing matched", () => {
    const out = appendNuggetLookupContextForAgent("N999", 999, null);
    expect(out).toContain("not found");
  });

  it("instructs the agent on fetch error", () => {
    const out = appendNuggetLookupContextForAgent("N1", 1, null, "network down");
    expect(out).toContain("Lookup failed");
    expect(out).toContain("network down");
  });
});
