import { dolphinFetch, type OmadeusApiOptions } from "../utils/http.util.js";

type NuggetSearchParams = {
  /** Display nugget id from user text (e.g. N111 → 111). Matches API field `number`, not internal `id`. */
  nuggetNumber: number;
  signal?: AbortSignal;
};

export type OmadeusNuggetPriority = "low" | "medium" | "high" | "urgent";
export type OmadeusNuggetKind = "task" | "nugget";

export type CreateNuggetParams = {
  title: string;
  description: string;
  stage: string;
  kind: OmadeusNuggetKind;
  priority: OmadeusNuggetPriority;
  memberReferenceId: number;
  clientId: number;
  folderId: number;
  signal?: AbortSignal;
};

/** Omadeus nugget/task display number (`N###` in UI maps to this field). */
export function readNuggetNumber(record: Record<string, unknown>): number | undefined {
  const value = record["number"];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  return undefined;
}

function readNumberField(
  record: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = record[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  return undefined;
}

export function findNuggetRowByNumber(
  rows: Record<string, unknown>[],
  nuggetNumber: number,
): Record<string, unknown> | undefined {
  return rows.find((row) => readNuggetNumber(row) === nuggetNumber);
}

export function resolveTaskChannelRoomId(record: Record<string, unknown>): number | undefined {
  return (
    readNumberField(record, "privateRoomId") ??
    readNumberField(record, "publicRoomId") ??
    readNumberField(record, "sharedRoomId")
  );
}

function extractRows(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.filter(
      (entry): entry is Record<string, unknown> => !!entry && typeof entry === "object",
    );
  }
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const envelope = payload as Record<string, unknown>;
  const candidateKeys = ["data", "results", "items", "rows"];
  for (const key of candidateKeys) {
    const value = envelope[key];
    if (Array.isArray(value)) {
      return value.filter(
        (entry): entry is Record<string, unknown> => !!entry && typeof entry === "object",
      );
    }
  }
  return [];
}

/**
 * Dolphin SEARCH on nuggetviews returns an array of nugget/task rows.
 * User-facing `N111` corresponds to `number: 111` on each row (not `id`).
 */
export async function searchNuggetByNumber(
  opts: OmadeusApiOptions,
  params: NuggetSearchParams,
): Promise<Record<string, unknown> | null> {
  const query = `N${params.nuggetNumber}`;
  const search = new URLSearchParams();
  search.set("take", "100");

  const res = await dolphinFetch(opts, `/nuggetviews?${search.toString()}`, {
    method: "SEARCH",
    body: JSON.stringify({ query }),
    signal: params.signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Omadeus nugget search failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const payload = (await res.json()) as unknown;
  const rows = extractRows(payload);
  const match = findNuggetRowByNumber(rows, params.nuggetNumber);
  return match ?? null;
}

export async function resolveTaskRoomIdByNumber(
  opts: OmadeusApiOptions,
  params: NuggetSearchParams,
): Promise<number | null> {
  const row = await searchNuggetByNumber(opts, params);
  if (!row) {
    return null;
  }
  return resolveTaskChannelRoomId(row) ?? null;
}

export async function createNugget(
  opts: OmadeusApiOptions,
  params: CreateNuggetParams,
): Promise<Record<string, unknown>> {
  const res = await dolphinFetch(opts, "/nuggets", {
    method: "CREATE",
    body: JSON.stringify({
      title: params.title,
      stage: params.stage,
      description: params.description,
      kind: params.kind,
      priority: params.priority,
      memberReferenceId: params.memberReferenceId,
      clientId: params.clientId,
      folderId: params.folderId,
    }),
    signal: params.signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Omadeus nugget create failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return (await res.json()) as Record<string, unknown>;
}
