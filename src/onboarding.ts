import type { ChannelSetupWizard, OpenClawConfig, WizardPrompter } from "openclaw/plugin-sdk/setup";
import { DEFAULT_ACCOUNT_ID, formatDocsLink } from "openclaw/plugin-sdk/setup";
import {
  listOrganizationMembers,
  listOrganizations,
} from "./api/auth.api.js";
import { listMemberChannelViews } from "./api/channel.api.js";
import { authenticate } from "./auth.js";
import { getOmadeusChannelConfig, resolveOmadeusAccount } from "./config.js";
import { OMADEUS_CAS_URL, OMADEUS_MAESTRO_URL } from "./defaults.js";
import type {
  OmadeusChannelConfig,
  OmadeusChannelView,
  OmadeusOrganizationMember,
} from "./types.js";

const channel = "omadeus" as const;
const ALL_USERS = "__all_users__";
const DONE = "__done__";

type CoreConfig = OpenClawConfig & {
  channels?: { omadeus?: OmadeusChannelConfig };
};

type SelectOption = {
  value: string;
  label: string;
  hint?: string;
};

type MultiSelectPrompter = {
  multiSelect?: (args: {
    message: string;
    options: SelectOption[];
    initialValues?: string[];
    initialValue?: string[];
  }) => Promise<string[]>;
  multiselect?: (args: {
    message: string;
    options: SelectOption[];
    initialValues?: string[];
    initialValue?: string[];
  }) => Promise<string[]>;
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
  existingChannelViewIds?: number[];
}): Promise<OmadeusChannelView[]> {
  const { prompter, maestroUrl, sessionToken, memberReferenceId, existingChannelViewIds } = params;
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
  const selected = await promptMultiSelect({
    prompter,
    message: "Which channels should OpenClaw listen to?",
    options: channels.map((item) => ({
      value: String(item.id),
      label: item.title || `Channel ${item.id}`,
      hint: [item.privateRoomId ? `private:${item.privateRoomId}` : undefined, item.publicRoomId ? `public:${item.publicRoomId}` : undefined]
        .filter(Boolean)
        .join(" | "),
    })),
    initialValues:
      existingChannelViewIds && existingChannelViewIds.length > 0
        ? existingChannelViewIds.map(String)
        : [String(channels[0]!.id)],
  });
  const chosen = channels.filter((item) => selected.includes(String(item.id)));
  if (chosen.length === 0) {
    throw new Error("At least one channel must be selected.");
  }
  return chosen;
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

async function promptMultiSelect(params: {
  prompter: WizardPrompter;
  message: string;
  options: SelectOption[];
  initialValues?: string[];
}): Promise<string[]> {
  const multi = params.prompter as unknown as MultiSelectPrompter;
  const runMulti = multi.multiSelect ?? multi.multiselect;
  if (runMulti) {
    return runMulti({
      message: params.message,
      options: params.options,
      initialValues: params.initialValues,
      initialValue: params.initialValues,
    });
  }

  const selected = new Set(params.initialValues ?? []);
  while (true) {
    const next = await params.prompter.select({
      message: `${params.message} (${selected.size} selected)`,
      options: [
        { value: DONE, label: selected.size > 0 ? "Done" : "Done (select none)" },
        ...params.options.map((option) => ({
          ...option,
          label: selected.has(option.value) ? `[selected] ${option.label}` : option.label,
        })),
      ],
      initialValue: DONE,
    });
    const value = String(next);
    if (value === DONE) {
      return [...selected];
    }
    if (selected.has(value)) {
      selected.delete(value);
    } else {
      selected.add(value);
    }
  }
}

async function loadSelectableMembers(params: {
  maestroUrl: string;
  sessionToken: string;
  organizationId: number;
  excludeReferenceIds?: number[];
}): Promise<OmadeusOrganizationMember[]> {
  const excluded = new Set(params.excludeReferenceIds ?? []);
  return (
    await listOrganizationMembers({
      maestroUrl: params.maestroUrl,
      sessionToken: params.sessionToken,
      organizationId: params.organizationId,
    })
  )
    .filter((member) => member.isSystem !== true && !excluded.has(member.referenceId))
    .sort((a, b) => memberLabel(a).localeCompare(memberLabel(b)));
}

function memberOptions(members: OmadeusOrganizationMember[]): SelectOption[] {
  return members.map((member) => ({
    value: String(member.referenceId),
    label: memberLabel(member),
    hint: memberHint(member),
  }));
}

function readReferenceIds(values: string[]): number[] {
  return values
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);
}

async function promptSenderAllowlist(params: {
  prompter: WizardPrompter;
  message: string;
  members: OmadeusOrganizationMember[];
  existingReferenceIds?: number[];
  includeAllUsersOption?: boolean;
}): Promise<number[] | undefined> {
  const { prompter, message, members, existingReferenceIds, includeAllUsersOption = true } = params;
  if (members.length === 0) {
    throw new Error("No organization members found.");
  }
  const initialValues =
    existingReferenceIds && existingReferenceIds.length > 0
      ? existingReferenceIds.map(String)
      : includeAllUsersOption
        ? [ALL_USERS]
        : [];
  const selected = await promptMultiSelect({
    prompter,
    message,
    options: [
      ...(includeAllUsersOption
        ? [{ value: ALL_USERS, label: "All users", hint: "No sender allowlist" }]
        : []),
      ...memberOptions(members),
    ],
    initialValues,
  });
  if (selected.includes(ALL_USERS)) {
    return undefined;
  }
  return readReferenceIds(selected);
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
            validate: (value) => (String(value ?? "").trim() ? undefined : "Required"),
          }),
        ).trim();
      }
    }

    if (!sessionToken) {
      throw new Error("Authentication is required to list channels.");
    }

    if (typeof selfReferenceId !== "number") {
      throw new Error("Authentication did not return an Omadeus member reference ID.");
    }

    const members = await loadSelectableMembers({
      maestroUrl,
      sessionToken,
      organizationId,
      excludeReferenceIds: [selfReferenceId],
    });
    const existingInbound = section.inbound;

    const directSenderIds = await promptSenderAllowlist({
      prompter,
      message: "Which users can DM OpenClaw directly?",
      members,
      existingReferenceIds: existingInbound?.direct?.allowedSenderReferenceIds,
    });

    const selectedChannels = await promptChannelSelection({
      prompter,
      maestroUrl,
      sessionToken,
      memberReferenceId: selfReferenceId,
      existingChannelViewIds: existingInbound?.channels?.allowedChannelViewIds,
    });

    const channelSenderIds = await promptSenderAllowlist({
      prompter,
      message: "Which users can trigger OpenClaw from allowed channels?",
      members,
      existingReferenceIds: existingInbound?.channels?.allowedSenderReferenceIds,
    });

    const entitySenderIds = await promptSenderAllowlist({
      prompter,
      message: "Which users can trigger OpenClaw from entity rooms?",
      members,
      existingReferenceIds: existingInbound?.entities?.allowedSenderReferenceIds,
    });

    const channelRoomIds = selectedChannels
      .flatMap((selectedChannel) => [
        selectedChannel.publicRoomId,
        selectedChannel.privateRoomId,
      ])
      .filter((id): id is number => typeof id === "number");
    const channelViewIds = selectedChannels.map((selectedChannel) => selectedChannel.id);
    const channelTitles = selectedChannels
      .map((selectedChannel) => selectedChannel.title || `Channel ${selectedChannel.id}`)
      .join(", ");

    const senderSummary = (ids: number[] | undefined) =>
      ids && ids.length > 0 ? ids.join(", ") : "all users";

    await prompter.note(
      [
        `Inbound policy (Jaguar chat):`,
        `- Direct messages: enabled for ${senderSummary(directSenderIds)} (no @mention required).`,
        `- Channels "${channelTitles}": rooms ${channelRoomIds.join(", ") || "(no room ids)"} from ${senderSummary(channelSenderIds)}; @mention not required in those rooms.`,
        `- Entity rooms (task, nugget, project, release, sprint, summary, client, folder): ${senderSummary(entitySenderIds)}; @mention required.`,
      ].join("\n"),
      "Omadeus inbound policy",
    );

    next = {
      ...next,
      channels: {
        ...next.channels,
        omadeus: {
          enabled: true,
          casUrl,
          maestroUrl,
          email,
          password,
          organizationId,
          ...(sessionToken ? { sessionToken } : {}),
          inbound: {
            version: 1,
            direct: {
              enabled: true,
              ...(directSenderIds ? { allowedSenderReferenceIds: directSenderIds } : {}),
              requireMention: "never",
            },
            channels: {
              enabled: true,
              allowedRoomIds: channelRoomIds,
              allowedChannelViewIds: channelViewIds,
              ...(channelSenderIds ? { allowedSenderReferenceIds: channelSenderIds } : {}),
              requireMention: "outsideAllowlist",
            },
            entities: {
              enabled: true,
              allowedKinds: [
                "task",
                "nugget",
                "project",
                "release",
                "sprint",
                "summary",
                "client",
                "folder",
              ],
              ...(entitySenderIds ? { allowedSenderReferenceIds: entitySenderIds } : {}),
              requireMention: "always",
            },
          },
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
