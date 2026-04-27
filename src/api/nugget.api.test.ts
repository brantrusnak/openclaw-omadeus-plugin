import { describe, expect, it } from "vitest";
import { findNuggetRowByNumber, readNuggetNumber, resolveTaskChannelRoomId } from "./nugget.api.js";

describe("readNuggetNumber", () => {
  it("reads only the display number field", () => {
    expect(readNuggetNumber({ id: 21819, number: 12255 })).toBe(12255);
    expect(readNuggetNumber({ id: 21819 })).toBeUndefined();
  });

  it("accepts string numbers", () => {
    expect(readNuggetNumber({ number: "111" })).toBe(111);
  });
});

describe("findNuggetRowByNumber", () => {
  it("picks the row whose number matches N### (not internal id)", () => {
    const rows = [
      { id: 1, number: 11107, title: "wrong" },
      { id: 21819, number: 12255, title: "match" },
    ] as Record<string, unknown>[];
    expect(findNuggetRowByNumber(rows, 12255)).toEqual(rows[1]);
    expect(findNuggetRowByNumber(rows, 12256)).toBeUndefined();
  });
});

describe("resolveTaskChannelRoomId", () => {
  it("prefers private room id for task delivery", () => {
    expect(resolveTaskChannelRoomId({ privateRoomId: 117961, publicRoomId: 117962 })).toBe(117961);
  });

  it("falls back through public/shared room ids", () => {
    expect(resolveTaskChannelRoomId({ publicRoomId: 117962 })).toBe(117962);
    expect(resolveTaskChannelRoomId({ sharedRoomId: 5555 })).toBe(5555);
  });
});
