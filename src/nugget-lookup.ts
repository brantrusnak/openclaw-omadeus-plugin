export type NuggetLookupIntent = {
  /** Display nugget number from `N###` (maps to API `number`, not internal `id`). */
  nuggetNumber: number;
};

export type TaskChannelTargetIntent = {
  nuggetNumber: number;
  rawPrefix: "n" | "t";
};

export function parseNuggetLookupIntent(rawBody: string): NuggetLookupIntent | null {
  const body = rawBody.trim();
  if (!body) {
    return null;
  }
  const idMatch = /\bN(\d+)\b/i.exec(body);
  if (!idMatch) {
    return null;
  }
  const nuggetNumber = Number(idMatch[1]);
  if (!Number.isFinite(nuggetNumber)) {
    return null;
  }

  if (/^N\d+\??$/i.test(body)) {
    return { nuggetNumber };
  }
  if (/\bnugget\s+N?\d+\b/i.test(body)) {
    return { nuggetNumber };
  }
  if (/\b(get|show|lookup|find|search|status|detail|info)\b/i.test(body)) {
    return { nuggetNumber };
  }
  return null;
}

export function parseTaskChannelTargetIntent(rawInput: string): TaskChannelTargetIntent | null {
  const trimmed = rawInput.trim();
  const match = /^([nt])(\d+)$/i.exec(trimmed);
  if (!match) {
    return null;
  }
  const nuggetNumber = Number(match[2]);
  if (!Number.isFinite(nuggetNumber)) {
    return null;
  }
  return {
    nuggetNumber,
    rawPrefix: match[1]!.toLowerCase() as "n" | "t",
  };
}

export type ChannelTaskCreateIntent = {
  kind: "task" | "nugget";
  title: string;
  description: string;
  priority: "low" | "medium" | "high" | "urgent";
};

export type RecurringScheduleIntent = {
  everyMinutes: number;
};

function resolvePriorityFromText(text: string): ChannelTaskCreateIntent["priority"] {
  const lowered = text.toLowerCase();
  if (/\b(urgent|asap|critical|p0)\b/.test(lowered)) return "urgent";
  if (/\b(high|important|p1)\b/.test(lowered)) return "high";
  if (/\b(medium|normal|p2)\b/.test(lowered)) return "medium";
  return "low";
}

export function parseChannelTaskCreateIntent(rawBody: string): ChannelTaskCreateIntent | null {
  const body = rawBody.trim();
  if (!body) {
    return null;
  }
  const lower = body.toLowerCase();
  const isCreateVerb = /\b(create|open|add|spawn|start)\b/.test(lower);
  const hasTaskWord = /\b(task|nugget)\b/.test(lower);
  if (!isCreateVerb || !hasTaskWord) {
    return null;
  }

  const kind: "task" | "nugget" = /\bnugget\b/.test(lower) ? "nugget" : "task";
  // Trim obvious command prefixes to leave a natural title candidate.
  const candidate = body
    .replace(/^\s*(please\s+)?(create|open|add|spawn|start)\s+(a\s+|an\s+)?(new\s+)?/i, "")
    .replace(/^(task|nugget)\s*/i, "")
    .trim();
  const title = candidate || `${kind === "task" ? "Task" : "Nugget"} from channel request`;
  const description = body;
  return {
    kind,
    title,
    description,
    priority: resolvePriorityFromText(body),
  };
}

export function parseRecurringScheduleIntent(rawBody: string): RecurringScheduleIntent | null {
  const lowered = rawBody.toLowerCase();
  // every 5 min / every 5 mins / every 5 minutes
  const minuteMatch = /\bevery\s+(\d+)\s*(m|min|mins|minute|minutes)\b/.exec(lowered);
  if (minuteMatch) {
    const everyMinutes = Number(minuteMatch[1]);
    if (Number.isFinite(everyMinutes) && everyMinutes > 0) {
      return { everyMinutes: Math.min(60, everyMinutes) };
    }
  }
  // every hour / hourly
  if (/\bevery\s+hour\b|\bhourly\b/.test(lowered)) {
    return { everyMinutes: 60 };
  }
  return null;
}

/** Fields from Dolphin nuggetviews that are useful for an agent summary (avoids huge payloads). */
const NUGGET_FIELDS_FOR_AGENT = [
  "number",
  "id",
  "title",
  "description",
  "status",
  "stage",
  "leadPhaseTitle",
  "priority",
  "priorityValue",
  "dueDate",
  "kind",
  "entityType",
  "tempo",
  "projectTitle",
  "projectStatus",
  "projectNumber",
  "projectManagerFirstName",
  "projectManagerLastName",
  "projectManagerTitle",
  "projectManagerReferenceId",
  "clientTitle",
  "folderTitle",
  "createdAt",
  "autoModifiedAt",
  "lastMovingTime",
  "responseTimestamp",
  "assignmentLevel",
  "estimated",
  "sprintName",
  "sprintNumber",
  "releaseTitle",
  "releaseNumber",
  "publicRoomId",
  "privateRoomId",
] as const;

export function pickNuggetFieldsForAgent(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of NUGGET_FIELDS_FOR_AGENT) {
    if (key in record) {
      out[key] = record[key];
    }
  }
  return out;
}

/**
 * Augments the user message so the agent receives Dolphin nugget/task data and can reply with a summary.
 * On miss or API error, the agent still gets instructions to respond helpfully.
 */
export function appendNuggetLookupContextForAgent(
  rawBody: string,
  nuggetNumber: number,
  record: Record<string, unknown> | null,
  fetchError?: string,
): string {
  const header = `[Omadeus nugget/task N${nuggetNumber}]`;

  if (fetchError) {
    return (
      `${rawBody}\n\n${header} Lookup failed: ${fetchError}\n` +
      `Briefly explain the error to the user and suggest they try again or check permissions.`
    );
  }

  if (!record) {
    return (
      `${rawBody}\n\n${header} No row matched display number ${nuggetNumber} (field \`number\`) in search results.\n` +
      `Tell the user succinctly that this nugget/task was not found.`
    );
  }

  const payload = pickNuggetFieldsForAgent(record);
  return (
    `${rawBody}\n\n${header} Data from Omadeus (summarize for someone tracking this work — status, ownership, timeline, project; plain language):\n` +
    `${JSON.stringify(payload, null, 2)}`
  );
}
