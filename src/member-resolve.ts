import { listOrganizationMembers } from "./api/auth.api.js";
import type { OmadeusOrganizationMember } from "./types.js";
import type { OmadeusApiOptions } from "./utils/http.util.js";

export function formatMemberLabel(m: OmadeusOrganizationMember): string {
  const fullName = `${m.firstName ?? ""} ${m.lastName ?? ""}`.trim();
  if (fullName) {
    return fullName;
  }
  if (m.title?.trim()) {
    return m.title.trim();
  }
  if (m.email?.trim()) {
    return m.email.trim();
  }
  return `Member ${m.referenceId}`;
}

/**
 * Resolves Omadeus `referenceId` → human-readable label for the current organization (session JWT).
 * Used so agents do not echo raw ids like 210 to users.
 */
export async function buildReferenceIdNameMap(
  apiOpts: OmadeusApiOptions,
): Promise<Map<number, string>> {
  const { organizationId } = apiOpts.tokenManager.getPayload();
  const sessionToken = apiOpts.tokenManager.getToken();
  const members = await listOrganizationMembers({
    maestroUrl: apiOpts.maestroUrl,
    sessionToken,
    organizationId,
  });
  const map = new Map<number, string>();
  for (const m of members) {
    map.set(m.referenceId, formatMemberLabel(m));
  }
  return map;
}

/**
 * Adds a `people` object mapping each `*ReferenceId` field in the nugget row to a display name.
 * Keys match the source field names (e.g. `memberReferenceId: "Pat Example"`).
 */
export async function mergePeopleIntoNuggetAgentPayload(
  apiOpts: OmadeusApiOptions,
  fullRecord: Record<string, unknown>,
  basePayload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  let nameByRef: Map<number, string>;
  try {
    nameByRef = await buildReferenceIdNameMap(apiOpts);
  } catch {
    return { ...basePayload };
  }
  const people: Record<string, string> = {};
  for (const [key, v] of Object.entries(fullRecord)) {
    if (!/referenceid$/i.test(key)) {
      continue;
    }
    const id =
      typeof v === "number" && Number.isFinite(v)
        ? v
        : typeof v === "string" && /^\d+$/.test(v.trim())
          ? Number(v.trim())
          : NaN;
    if (!Number.isFinite(id)) {
      continue;
    }
    const name = nameByRef.get(id);
    if (name) {
      people[key] = name;
    }
  }
  const out: Record<string, unknown> = { ...basePayload };
  if (Object.keys(people).length > 0) {
    out.people = people;
    for (const key of Object.keys(people)) {
      if (key in out) {
        delete out[key];
      }
    }
  }
  return out;
}
