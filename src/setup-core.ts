import type { ChannelSetupAdapter } from "openclaw/plugin-sdk/setup";
import type { OpenClawConfig } from "../runtime-api.js";

function readSetupStringField(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readSetupNumberField(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export const omadeusSetupAdapter: ChannelSetupAdapter = {
  validateInput: ({ input }) => {
    const rawInput = input as Record<string, unknown>;
    const email = readSetupStringField(rawInput, "email");
    if (!email && !input.useEnv) {
      return "Omadeus requires --email (or use OMADEUS_EMAIL env var).";
    }
    return null;
  },
  applyAccountConfig: ({ cfg, input }) => {
    const rawInput = input as Record<string, unknown>;
    const casUrl = input.httpUrl?.trim() || undefined;
    const maestroUrl = input.url?.trim() || undefined;
    const email = readSetupStringField(rawInput, "email");
    const password = input.password?.trim() || undefined;
    const organizationId = readSetupNumberField(rawInput, "organizationId");

    return {
      ...cfg,
      channels: {
        ...cfg.channels,
        omadeus: {
          ...(cfg.channels as Record<string, unknown>)?.["omadeus"],
          enabled: true,
          ...(casUrl ? { casUrl } : {}),
          ...(maestroUrl ? { maestroUrl } : {}),
          ...(email ? { email } : {}),
          ...(password ? { password } : {}),
          ...(organizationId ? { organizationId } : {}),
        },
      },
    } as OpenClawConfig;
  },
};
