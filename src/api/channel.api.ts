import type { OmadeusChannelView } from "../types.js";

export async function listMemberChannelViews(params: {
  maestroUrl: string;
  sessionToken: string;
  memberReferenceId: number;
  skip?: number;
  take?: number;
}): Promise<OmadeusChannelView[]> {
  const { maestroUrl, sessionToken, memberReferenceId, skip = 0, take = 100 } = params;
  const qs = new URLSearchParams({
    skip: String(skip),
    take: String(take),
    sort: "-recentMessageAt",
  });
  const url = `${maestroUrl}/jaguar/apiv1/members/${memberReferenceId}/channelviews?${qs.toString()}`;
  const res = await fetch(url, {
    method: "LIST",
    headers: {
      Authorization: `Bearer ${sessionToken}`,
      "Content-Type": "application/json;charset=UTF-8",
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Omadeus list channel views failed (${res.status}): ${text}`);
  }
  return (await res.json()) as OmadeusChannelView[];
}
