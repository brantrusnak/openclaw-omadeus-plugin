import { describe, expect, it } from "vitest";
import { isAllowedOmadeusReactionEmoji } from "./allowed-reaction-emojis.js";

describe("isAllowedOmadeusReactionEmoji", () => {
  it.each([
    ["👍", true],
    ["👎", true],
    ["❤️", true],
    ["❤", false],
    ["😂", true],
    ["😮", true],
    ["😢", true],
    ["🙏", true],
    ["🚀", false],
    ["", false],
    ["  👍  ", true],
  ])("%s -> %s", (emoji, expected) => {
    expect(isAllowedOmadeusReactionEmoji(emoji)).toBe(expected);
  });
});
