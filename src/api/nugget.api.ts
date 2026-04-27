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
 * Dolphin SEARCH on nuggetviews — arbitrary text query (e.g. N###, task title, or room id string).
 * Prefer filtering results with `findNuggetRowByNumber` or `findNuggetRowByRoomId`.
 */
export async function searchNuggetRowsByTextQuery(
  opts: OmadeusApiOptions,
  params: { query: string; take?: number; signal?: AbortSignal },
): Promise<Record<string, unknown>[]> {
  const take = params.take ?? 100;
  const q = params.query.trim();
  if (!q) {
    return [];
  }
  const search = new URLSearchParams();
  search.set("take", String(take));
  const res = await dolphinFetch(opts, `/nuggetviews?${search.toString()}`, {
    method: "SEARCH",
    body: JSON.stringify({ query: q }),
    signal: params.signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Omadeus nugget search failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const payload = (await res.json()) as unknown;
  return extractRows(payload);
}

/**
 * Picks a row whose private/public/shared task room id matches a Jaguar `roomId`.
 */
export function findNuggetRowByRoomId(
  rows: Record<string, unknown>[],
  roomId: number,
): Record<string, unknown> | undefined {
  for (const row of rows) {
    for (const key of ["privateRoomId", "publicRoomId", "sharedRoomId"] as const) {
      if (readNumberField(row, key) === roomId) {
        return row;
      }
    }
  }
  return undefined;
}

export type FindNuggetByTaskRoomParams = {
  roomId: number;
  roomName?: string | null;
  signal?: AbortSignal;
};

/**
 * Resolve the nugget/task row for a Jaguar Task or Nugget **chat room** by matching
 * `privateRoomId` / `publicRoomId` / `sharedRoomId` to `roomId` in Dolphin `nuggetviews` search results.
 * Tries search by `roomName` first (usually matches the task title), then by the numeric `roomId` as text.
 */
export async function findNuggetByTaskChannelRoom(
  opts: OmadeusApiOptions,
  params: FindNuggetByTaskRoomParams,
): Promise<Record<string, unknown> | null> {
  const { roomId, roomName, signal } = params;
  const tryQueries: string[] = [];
  if (typeof roomName === "string" && roomName.trim()) {
    tryQueries.push(roomName.trim());
  }
  tryQueries.push(String(roomId));
  const tried = new Set<string>();
  for (const query of tryQueries) {
    if (tried.has(query)) {
      continue;
    }
    tried.add(query);
    const rows = await searchNuggetRowsByTextQuery(opts, { query, take: 100, signal });
    const match = findNuggetRowByRoomId(rows, roomId);
    if (match) {
      return match;
    }
  }
  return null;
}

/**
 * Dolphin SEARCH on nuggetviews returns an array of nugget/task rows.
 * User-facing `N111` corresponds to `number: 111` on each row (not `id`).
 */
export async function searchNuggetByNumber(
  opts: OmadeusApiOptions,
  params: NuggetSearchParams,
): Promise<Record<string, unknown> | null> {
  const rows = await searchNuggetRowsByTextQuery(opts, {
    query: `N${params.nuggetNumber}`,
    take: 100,
    signal: params.signal,
  });
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
