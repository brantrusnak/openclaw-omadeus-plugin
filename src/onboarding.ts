import type { ChannelSetupWizard, OpenClawConfig, WizardPrompter } from "openclaw/plugin-sdk/setup";
import { DEFAULT_ACCOUNT_ID, formatDocsLink } from "openclaw/plugin-sdk/setup";
import {
  listMemberChannelViews,
  listOrganizationMembers,
  listOrganizations,
} from "./api/auth.api.js";
import { authenticate } from "./auth.js";
import { getOmadeusChannelConfig, resolveOmadeusAccount } from "./config.js";
import { OMADEUS_CAS_URL, OMADEUS_MAESTRO_URL } from "./defaults.js";
import type {
  OmadeusChannelConfig,
  OmadeusChannelView,
  OmadeusOrganizationMember,
} from "./types.js";

const channel = "omadeus" as const;

type CoreConfig = OpenClawConfig & {
  channels?: { omadeus?: OmadeusChannelConfig };
};

function getOmadeusSection(cfg: OpenClawConfig): OmadeusChannelConfig | undefined {
  return getOmadeusChannelConfig(cfg as CoreConfig);
}

async function noteOmadeusAuthHelp(prompter: WizardPrompter): Promise<void> {
  await prompter.note(
    [
      "Omadeus authenticates via CAS + Maestro (email + password + organization).",
      "You need:",
      "  - Email + password",
      "  - Organization ID (we can look it up for you)",
      `CAS URL: ${OMADEUS_CAS_URL}`,
      `Maestro URL: ${OMADEUS_MAESTRO_URL}`,
      "Env vars supported: OMADEUS_EMAIL, OMADEUS_PASSWORD, OMADEUS_ORGANIZATION_ID.",
      `Docs: ${formatDocsLink("/channels/omadeus", "omadeus")}`,
    ].join("\n"),
    "Omadeus setup",
  );
}

async function promptOrganizationId(params: {
  prompter: WizardPrompter;
  maestroUrl: string;
  email: string;
  existing?: number;
}): Promise<number> {
  const { prompter, maestroUrl, email, existing } = params;

  // Try to list organizations from the API
  if (maestroUrl && email) {
    try {
      const orgs = await listOrganizations({ maestroUrl, email });
      if (orgs.length > 0) {
        if (orgs.length === 1) {
          await prompter.note(
            `Found organization: ${orgs[0]!.title} (${orgs[0]!.id})`,
            "Omadeus organization",
          );
          return orgs[0]!.id;
        }
        const choice = await prompter.select({
          message: "Select organization",
          options: orgs.map((org) => ({
            value: String(org.id),
            label: `${org.title} (${org.membersCount} members)`,
            hint: `ID: ${org.id}`,
          })),
          initialValue: existing ? String(existing) : String(orgs[0]!.id),
        });
        return Number(choice);
      }
    } catch {
      await prompter.note(
        "Could not fetch organizations from the API. Enter the ID manually.",
        "Omadeus organization",
      );
    }
  }

  const raw = await prompter.text({
    message: "Organization ID (number)",
    initialValue: existing ? String(existing) : undefined,
    validate: (value) => {
      const trimmed = String(value ?? "").trim();
      if (!trimmed) return "Required";
      if (!/^\d+$/.test(trimmed)) return "Must be a number";
      return undefined;
    },
  });
  return Number(String(raw).trim());
}

async function promptChannelSelection(params: {
  prompter: WizardPrompter;
  maestroUrl: string;
  sessionToken: string;
  memberReferenceId: number;
  existing?: OmadeusChannelConfig;
}): Promise<{
  selectedChannelViewId: number;
  selectedChannelTitle: string;
  selectedChannelPrivateRoomId?: number;
  selectedChannelPublicRoomId?: number;
}> {
  const { prompter, maestroUrl, sessionToken, memberReferenceId, existing } = params;
  const channels = await listMemberChannelViews({
    maestroUrl,
    sessionToken,
    memberReferenceId,
    skip: 0,
    take: 100,
  });
  if (channels.length === 0) {
    throw new Error("No channels found for this account.");
  }
  const selected = await prompter.select({
    message: "Which channel to use?",
    options: channels.map((item) => ({
      value: String(item.id),
      label: item.title || `Channel ${item.id}`,
    })),
    initialValue:
      existing?.selectedChannelViewId !== undefined
        ? String(existing.selectedChannelViewId)
        : String(channels[0]!.id),
  });
  const chosen = channels.find((item) => String(item.id) === String(selected));
  if (!chosen) {
    throw new Error("Selected channel was not found.");
  }
  return {
    selectedChannelViewId: chosen.id,
    selectedChannelTitle: chosen.title,
    ...(typeof chosen.privateRoomId === "number"
      ? { selectedChannelPrivateRoomId: chosen.privateRoomId }
      : {}),
    ...(typeof chosen.publicRoomId === "number"
      ? { selectedChannelPublicRoomId: chosen.publicRoomId }
      : {}),
  };
}

function memberLabel(member: OmadeusOrganizationMember): string {
  const fullName = `${member.firstName ?? ""} ${member.lastName ?? ""}`.trim();
  if (member.title?.trim()) {
    return member.title.trim();
  }
  if (fullName) {
    return fullName;
  }
  if (member.email?.trim()) {
    return member.email.trim();
  }
  return `Member ${member.referenceId}`;
}

function memberHint(member: OmadeusOrganizationMember): string | undefined {
  const fullName = `${member.firstName ?? ""} ${member.lastName ?? ""}`.trim();
  const parts = [fullName, member.email?.trim(), `ref:${member.referenceId}`].filter(Boolean);
  return parts.length > 0 ? parts.join(" | ") : undefined;
}

function filterMembersByQuery(
  members: OmadeusOrganizationMember[],
  query: string,
): OmadeusOrganizationMember[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return members;
  }
  return members.filter((member) => {
    const fields = [
      String(member.referenceId),
      member.title ?? "",
      member.firstName ?? "",
      member.lastName ?? "",
      member.email ?? "",
    ].map((value) => value.toLowerCase());
    return fields.some((value) => value.includes(q));
  });
}

async function promptMemberSelection(params: {
  prompter: WizardPrompter;
  maestroUrl: string;
  sessionToken: string;
  organizationId: number;
  existingMemberReferenceId?: number;
  fallbackMemberReferenceId?: number;
}): Promise<{ memberReferenceId: number; memberTitle: string }> {
  const {
    prompter,
    maestroUrl,
    sessionToken,
    organizationId,
    existingMemberReferenceId,
    fallbackMemberReferenceId,
  } = params;

  const members = (
    await listOrganizationMembers({
      maestroUrl,
      sessionToken,
      organizationId,
    })
  )
    .filter((member) => member.isSystem !== true)
    .sort((a, b) => memberLabel(a).localeCompare(memberLabel(b)));

  if (members.length === 0) {
    throw new Error("No organization members found.");
  }

  while (true) {
    const query = String(
      await prompter.text({
        message: "Search member to listen to (name/title/email/referenceId, optional)",
        placeholder: "e.g. John Doe",
      }),
    );
    const filtered = filterMembersByQuery(members, query).slice(0, 100);
    if (filtered.length === 0) {
      await prompter.note("No members matched that search. Try another query.", "Omadeus member");
      continue;
    }

    const defaultRef = existingMemberReferenceId ?? fallbackMemberReferenceId;
    const selected = await prompter.select({
      message: "Which member should OpenClaw listen to?",
      options: filtered.map((member) => ({
        value: String(member.referenceId),
        label: memberLabel(member),
        hint: memberHint(member),
      })),
      initialValue:
        defaultRef !== undefined && filtered.some((member) => member.referenceId === defaultRef)
          ? String(defaultRef)
          : String(filtered[0]!.referenceId),
    });
    const chosen = filtered.find((member) => String(member.referenceId) === String(selected));
    if (!chosen) {
      await prompter.note("Could not resolve selected member. Please retry.", "Omadeus member");
      continue;
    }
    return {
      memberReferenceId: chosen.referenceId,
      memberTitle: memberLabel(chosen),
    };
  }
}

export const omadeusSetupWizard: ChannelSetupWizard = {
  channel,
  resolveAccountIdForConfigure: () => DEFAULT_ACCOUNT_ID,
  resolveShouldPromptAccountIds: () => false,
  status: {
    configuredLabel: "configured",
    unconfiguredLabel: "needs credentials",
    configuredHint: "configured",
    unconfiguredHint: "needs credentials",
    configuredScore: 2,
    unconfiguredScore: 0,
    resolveConfigured: ({ cfg }) => {
      const account = resolveOmadeusAccount({ cfg });
      return account.credentialSource !== "none";
    },
    resolveStatusLines: ({ cfg }) => {
      const account = resolveOmadeusAccount({ cfg });
      const configured = account.credentialSource !== "none";
      return [
        `Omadeus: ${configured ? "configured" : "needs email, password, and organization ID"}`,
      ];
    },
    resolveSelectionHint: ({ cfg }) => {
      const account = resolveOmadeusAccount({ cfg });
      return account.credentialSource !== "none" ? "configured" : "needs credentials";
    },
    resolveQuickstartScore: ({ cfg }) => {
      const account = resolveOmadeusAccount({ cfg });
      return account.credentialSource !== "none" ? 2 : 0;
    },
  },
  credentials: [],
  finalize: async ({ cfg, prompter }) => {
    const account = resolveOmadeusAccount({ cfg });
    const section = getOmadeusSection(cfg) ?? {};
    let next = cfg;

    if (account.credentialSource === "none") {
      await noteOmadeusAuthHelp(prompter);
    }

    const envEmail = process.env.OMADEUS_EMAIL?.trim();
    const envPassword = process.env.OMADEUS_PASSWORD?.trim();

    const casUrl = OMADEUS_CAS_URL;
    const maestroUrl = OMADEUS_MAESTRO_URL;

    let email = String(
      await prompter.text({
        message: "Omadeus username (email)",
        initialValue: section.email ?? envEmail,
        validate: (value) => (String(value ?? "").trim() ? undefined : "Required"),
      }),
    ).trim();

    let password = String(
      await prompter.text({
        message: "Omadeus password",
        initialValue: section.password ?? envPassword,
        sensitive: true,
        validate: (value) => (String(value ?? "").trim() ? undefined : "Required"),
      }),
    ).trim();

    const organizationId = await promptOrganizationId({
      prompter,
      maestroUrl,
      email,
      existing: section.organizationId,
    });

    // Verify the full auth flow before saving
    let sessionToken: string | undefined;
    let selfReferenceId: number | undefined;
    while (true) {
      try {
        const { dolphinToken, payload } = await authenticate({
          casUrl,
          maestroUrl,
          email,
          password,
          organizationId,
        });
        sessionToken = dolphinToken;
        selfReferenceId = payload.referenceId;
        await prompter.note(`Authenticated as ${payload.email}`, "Omadeus authentication");
        break;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await prompter.note(`Authentication failed: ${msg}`, "Omadeus authentication");
        const retry = await prompter.confirm({
          message: "Re-enter email/password and try again?",
          initialValue: true,
        });
        if (!retry) {
          await prompter.note(
            "Saving config without verifying credentials. The gateway may fail to connect.",
            "Omadeus authentication",
          );
          break;
        }
        email = String(
          await prompter.text({
            message: "Omadeus email",
            initialValue: email,
            validate: (value) => (String(value ?? "").trim() ? undefined : "Required"),
          }),
        ).trim();
        password = String(
          await prompter.text({
            message: "Omadeus password",
            initialValue: password,
            sensitive: true,
            validate: (value) => (String(value ?? "").trim() ? undefined : "Required"),
          }),
        ).trim();
      }
    }

    if (!sessionToken) {
      throw new Error("Authentication is required to list channels.");
    }

    const selectedMember = await promptMemberSelection({
      prompter,
      maestroUrl,
      sessionToken,
      organizationId,
      existingMemberReferenceId: section.selectedMemberReferenceId,
      fallbackMemberReferenceId: selfReferenceId,
    });

    const selectedChannel = await promptChannelSelection({
      prompter,
      maestroUrl,
      sessionToken,
      memberReferenceId: selectedMember.memberReferenceId,
      existing: section,
    });

    await prompter.note(
      `Omadeus will process only "${selectedChannel.selectedChannelTitle}" for member ${selectedMember.memberTitle} (${selectedMember.memberReferenceId}), plus task private-chat mentions.`,
      "Omadeus channel scope",
    );

    next = {
      ...next,
      channels: {
        ...next.channels,
        omadeus: {
          ...getOmadeusSection(next),
          enabled: true,
          casUrl,
          maestroUrl,
          email,
          password,
          organizationId,
          ...(sessionToken ? { sessionToken } : {}),
          selectedMemberReferenceId: selectedMember.memberReferenceId,
          selectedChannelViewId: selectedChannel.selectedChannelViewId,
          selectedChannelTitle: selectedChannel.selectedChannelTitle,
          ...(selectedChannel.selectedChannelPrivateRoomId !== undefined
            ? { selectedChannelPrivateRoomId: selectedChannel.selectedChannelPrivateRoomId }
            : {}),
          ...(selectedChannel.selectedChannelPublicRoomId !== undefined
            ? { selectedChannelPublicRoomId: selectedChannel.selectedChannelPublicRoomId }
            : {}),
        },
      },
    };

    return { cfg: next, accountId: DEFAULT_ACCOUNT_ID };
  },
  disable: (cfg) => ({
    ...cfg,
    channels: {
      ...cfg.channels,
      omadeus: { ...getOmadeusSection(cfg), enabled: false },
    },
  }),
};

export const omadeusOnboardingAdapter = omadeusSetupWizard;
