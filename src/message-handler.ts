import {
  DEFAULT_ACCOUNT_ID,
  logInboundDrop,
  resolveControlCommandGate,
  type OpenClawConfig,
  type RuntimeEnv,
} from "../runtime-api.js";
import { createNugget, resolveTaskChannelRoomId, searchNuggetByNumber } from "./api/nugget.api.js";
import {
  appendNuggetLookupContextForAgent,
  parseChannelTaskCreateIntent,
  parseNuggetLookupIntent,
  parseRecurringScheduleIntent,
} from "./nugget-lookup.js";
import type { OutboundDeps } from "./outbound.js";
import { createOmadeusReplyDispatcher } from "./reply-dispatcher.js";
import { getOmadeusChannelConfig } from "./config.js";
import { evaluateOmadeusInboundPolicy } from "./inbound-policy.js";
import { getOmadeusRuntime } from "./runtime.js";
import type { OmadeusInboundMessage } from "./types.js";

type Log = {
  info: (msg: string, extra?: Record<string, unknown>) => void;
  warn: (msg: string, extra?: Record<string, unknown>) => void;
  error: (msg: string, extra?: Record<string, unknown>) => void;
  debug?: (msg: string, extra?: Record<string, unknown>) => void;
};

export type OmadeusMessageHandlerDeps = {
  cfg: OpenClawConfig;
  runtime: RuntimeEnv;
  log: Log;
  outboundDeps: OutboundDeps;
  /** Authenticated Omadeus user; used to drop self-authored messages and inbound policy. */
  selfReferenceId: number;
};

export function createOmadeusMessageHandler(deps: OmadeusMessageHandlerDeps) {
  const { cfg, runtime, log, outboundDeps, selfReferenceId } = deps;
  const core = getOmadeusRuntime();
  const omadeusCfg = getOmadeusChannelConfig(cfg);

  const inboundDebounceMs = core.channel.debounce.resolveInboundDebounceMs({
    cfg,
    channel: "omadeus",
  });

  const handleMessageNow = async (inbound: OmadeusInboundMessage) => {
    const isDirectMessage = inbound.subscribableKind === "direct";
    const senderId = String(inbound.fromReferenceId);
    const senderName = inbound.from;
    const roomId = String(inbound.roomId);
    const rawBody = inbound.content;

    if (!rawBody.trim()) {
      log.debug?.("skipping empty message");
      return;
    }

    const policyDecision = evaluateOmadeusInboundPolicy({
      inbound,
      omadeusCfg,
      selfReferenceId,
    });
    if (!policyDecision.allow) {
      log.info("omadeus: dropped message by inbound policy", {
        reason: policyDecision.reason,
        ...(policyDecision.details ?? {}),
        roomId: inbound.roomId,
        kind: inbound.subscribableKind,
        fromReferenceId: inbound.fromReferenceId,
        isMention: inbound.isMention,
      });
      return;
    }

    const useAccessGroups =
      (cfg.commands as Record<string, unknown> | undefined)?.useAccessGroups !== false;

    const hasControlCommand = core.channel.text.hasControlCommand(rawBody, cfg);
    const commandGate = resolveControlCommandGate({
      useAccessGroups,
      authorizers: [],
      allowTextCommands: true,
      hasControlCommand,
    });

    if (commandGate.shouldBlock) {
      logInboundDrop({
        log: (msg) => log.debug?.(msg),
        channel: "omadeus",
        reason: "control command (unauthorized)",
        target: senderId,
      });
      return;
    }

    let bodyForAgent = rawBody;
    const createIntent = parseChannelTaskCreateIntent(rawBody);
    if (createIntent) {
      try {
        const memberReferenceId = inbound.fromReferenceId;
        const created = await createNugget(outboundDeps.apiOpts, {
          title: createIntent.title,
          description: createIntent.description,
          kind: createIntent.kind,
          priority: createIntent.priority,
          stage: "Triage",
          memberReferenceId,
          clientId: 1,
          folderId: 1,
        });
        const createdLabel =
          typeof created["number"] === "number"
            ? `N${created["number"]}`
            : String(created["id"] ?? "created");
        const recurring = parseRecurringScheduleIntent(rawBody);
        if (recurring && typeof created["number"] === "number") {
          const cronExpr = recurring.everyMinutes === 60 ? "0 * * * *" : `*/${recurring.everyMinutes} * * * *`;
          const taskRoomId = resolveTaskChannelRoomId(created);
          const taskTarget = taskRoomId ? `room:${taskRoomId}` : `N${created["number"]}`;
          bodyForAgent =
            `${rawBody}\n\n` +
            `[Omadeus create] Created ${createIntent.kind} ${createdLabel}.\n` +
            `[Scheduling required] The user asked for recurring execution.\n` +
            `You MUST use the cron tool now (no simulation) to add a job with:\n` +
            `- schedule.kind: "cron"\n` +
            `- schedule.expr: "${cronExpr}"\n` +
            `- payload.kind: "agentTurn"\n` +
            `- payload.message: "${createIntent.description}"\n` +
            `- payload.deliver: true\n` +
            `- payload.channel: "omadeus"\n` +
            `- payload.to: "${taskTarget}"\n` +
            `- sessionTarget: "isolated"\n` +
            `- delivery.mode: "announce"\n` +
            `- delivery.channel: "omadeus"\n` +
            `- delivery.to: "${taskTarget}"\n` +
            `Do NOT deliver to the current selected channel; delivery must go only to the created task private channel target above.\n` +
            `Then confirm cron job creation to the user.`;
        } else {
          bodyForAgent = `${rawBody}\n\n[Omadeus create] Created ${createIntent.kind} ${createdLabel}.`;
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        runtime.error?.(`omadeus channel-triggered task create failed: ${errorMessage}`);
      }
    }

    const nuggetIntent = parseNuggetLookupIntent(rawBody);
    if (nuggetIntent) {
      try {
        const nugget = await searchNuggetByNumber(outboundDeps.apiOpts, {
          nuggetNumber: nuggetIntent.nuggetNumber,
        });
        bodyForAgent = appendNuggetLookupContextForAgent(
          rawBody,
          nuggetIntent.nuggetNumber,
          nugget,
        );
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        runtime.error?.(`omadeus nugget lookup failed: ${errorMessage}`);
        bodyForAgent = appendNuggetLookupContextForAgent(
          rawBody,
          nuggetIntent.nuggetNumber,
          null,
          errorMessage,
        );
      }
    }

    const omadeusFrom = isDirectMessage ? `omadeus:${senderId}` : `omadeus:group:${roomId}`;
    const omadeusTo = isDirectMessage ? `room:${roomId}` : `room:${roomId}`;

    const route = core.channel.routing.resolveAgentRoute({
      cfg,
      channel: "omadeus",
      peer: {
        kind: isDirectMessage ? "direct" : "group",
        id: isDirectMessage ? senderId : roomId,
      },
    });

    const preview = rawBody.replace(/\s+/g, " ").slice(0, 160);
    const inboundLabel = isDirectMessage
      ? `Omadeus DM from ${senderName}`
      : `Omadeus message in ${inbound.subscribableKind}/${inbound.roomName ?? roomId} from ${senderName}`;

    core.system.enqueueSystemEvent(`${inboundLabel}: ${preview}`, {
      sessionKey: route.sessionKey,
      contextKey: `omadeus:message:${roomId}:${inbound.timestamp}`,
    });

    const envelopeFrom = isDirectMessage ? senderName : (inbound.roomName ?? roomId);
    const storePath = core.channel.session.resolveStorePath(
      (cfg.session as Record<string, unknown> | undefined)?.store as string | undefined,
      { agentId: route.agentId },
    );
    const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(cfg);
    const timestamp = inbound.timestamp ? new Date(inbound.timestamp) : undefined;
    const previousTimestamp = core.channel.session.readSessionUpdatedAt({
      storePath,
      sessionKey: route.sessionKey,
    });

    const body = core.channel.reply.formatAgentEnvelope({
      channel: "Omadeus",
      from: envelopeFrom,
      timestamp,
      previousTimestamp,
      envelope: envelopeOptions,
      body: rawBody,
    });

    const ctxPayload = core.channel.reply.finalizeInboundContext({
      Body: body,
      BodyForAgent: bodyForAgent,
      RawBody: rawBody,
      CommandBody: rawBody.trim(),
      BodyForCommands: rawBody.trim(),
      /** Lets the message tool default `react` / `edit` to this Jaguar message id. */
      MessageSid: String(inbound.messageId),
      From: omadeusFrom,
      To: omadeusTo,
      SessionKey: route.sessionKey,
      AccountId: route.accountId,
      ChatType: isDirectMessage ? "direct" : "group",
      ConversationLabel: envelopeFrom,
      GroupSubject: !isDirectMessage ? (inbound.roomName ?? inbound.subscribableKind) : undefined,
      SenderName: senderName,
      SenderId: senderId,
      Provider: "omadeus" as const,
      Surface: "omadeus" as const,
      Timestamp: inbound.timestamp ?? Date.now(),
      WasMentioned: isDirectMessage || inbound.isMention,
      CommandAuthorized: commandGate.commandAuthorized,
      OriginatingChannel: "omadeus" as const,
      OriginatingTo: omadeusTo,
    });

    await core.channel.session.recordInboundSession({
      storePath,
      sessionKey: ctxPayload.SessionKey ?? route.sessionKey,
      ctx: ctxPayload,
      onRecordError: (err) => {
        log.debug?.(`omadeus: failed updating session meta: ${String(err)}`);
      },
    });

    const { dispatcher, replyOptions, markDispatchIdle } = createOmadeusReplyDispatcher({
      cfg,
      agentId: route.agentId,
      accountId: route.accountId,
      runtime,
      log,
      outboundDeps,
      roomId,
    });

    log.info("dispatching to agent", { sessionKey: route.sessionKey });
    try {
      const { queuedFinal, counts } = await core.channel.reply.withReplyDispatcher({
        dispatcher,
        onSettled: () => {
          markDispatchIdle();
        },
        run: () =>
          core.channel.reply.dispatchReplyFromConfig({
            ctx: ctxPayload,
            cfg,
            dispatcher,
            replyOptions,
          }),
      });

      log.info("dispatch complete", { queuedFinal, counts });
      const finalCount = counts.final;
      if (queuedFinal) {
        log.debug?.(
          `omadeus: delivered ${finalCount} repl${finalCount === 1 ? "y" : "ies"} to room ${roomId}`,
        );
      }
    } catch (err) {
      log.error("dispatch failed", { error: String(err) });
      runtime.error?.(`omadeus dispatch failed: ${String(err)}`);
    }
  };

  const inboundDebouncer = core.channel.debounce.createInboundDebouncer<OmadeusInboundMessage>({
    debounceMs: inboundDebounceMs,
    buildKey: (entry) => {
      return `omadeus:${entry.roomId}:${entry.fromReferenceId}`;
    },
    shouldDebounce: (entry) => {
      if (!entry.content.trim()) return false;
      return !core.channel.text.hasControlCommand(entry.content, cfg);
    },
    onFlush: async (entries) => {
      const last = entries.at(-1);
      if (!last) return;

      if (entries.length === 1) {
        await handleMessageNow(last);
        return;
      }

      // Combine debounced messages into a single inbound
      const combinedContent = entries
        .map((e) => e.content)
        .filter(Boolean)
        .join("\n");
      if (!combinedContent.trim()) return;

      await handleMessageNow({
        ...last,
        content: combinedContent,
        isMention: entries.some((e) => e.isMention),
      });
    },
    onError: (err) => {
      runtime.error?.(`omadeus debounce flush failed: ${String(err)}`);
    },
  });

  return async function handleOmadeusMessage(inbound: OmadeusInboundMessage) {
    await inboundDebouncer.enqueue(inbound);
  };
}
