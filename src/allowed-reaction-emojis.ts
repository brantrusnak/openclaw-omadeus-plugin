/**
 * Omadeus only accepts these exact reaction strings; any other value is ignored (no API call).
 */
export const ALLOWED_OMADEUS_REACTION_EMOJI_LIST = [
  "👍",
  "👎",
  "❤️",
  "😂",
  "😮",
  "😢",
  "🙏",
] as const;

const ALLOWED = new Set<string>(ALLOWED_OMADEUS_REACTION_EMOJI_LIST);

export function isAllowedOmadeusReactionEmoji(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) {
    return false;
  }
  return ALLOWED.has(trimmed);
}
