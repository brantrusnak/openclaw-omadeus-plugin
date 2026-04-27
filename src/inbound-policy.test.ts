import { describe, expect, it } from "vitest";
import { evaluateOmadeusInboundPolicy } from "./inbound-policy.js";
import type { OmadeusChannelConfig, OmadeusInboundMessage } from "./types.js";

const selfRef = 100;

function baseInbound(
  overrides: Partial<OmadeusInboundMessage> & Pick<OmadeusInboundMessage, "subscribableKind">,
): OmadeusInboundMessage {
  const { subscribableKind, subscribableType, ...rest } = overrides;
  return {
    messageId: 1,
    from: "200",
    fromReferenceId: 200,
    content: "hello",
    roomId: 10,
    roomName: "room",
    subscribableType: subscribableType ?? subscribableKind,
    subscribableKind,
    isMention: false,
    timestamp: Date.now(),
    ...rest,
  };
}

describe("evaluateOmadeusInboundPolicy", () => {
  it("drops self-authored messages", () => {
    const d = evaluateOmadeusInboundPolicy({
      inbound: baseInbound({ subscribableKind: "direct", fromReferenceId: selfRef }),
      omadeusCfg: {},
      selfReferenceId: selfRef,
    });
    expect(d.allow).toBe(false);
    if (!d.allow) expect(d.reason).toBe("self_message");
  });

  it("default config allows direct without mention", () => {
    const d = evaluateOmadeusInboundPolicy({
      inbound: baseInbound({ subscribableKind: "direct" }),
      omadeusCfg: {},
      selfReferenceId: selfRef,
    });
    expect(d.allow).toBe(true);
  });

  it("default config blocks channel messages", () => {
    const d = evaluateOmadeusInboundPolicy({
      inbound: baseInbound({ subscribableKind: "channel" }),
      omadeusCfg: {},
      selfReferenceId: selfRef,
    });
    expect(d.allow).toBe(false);
    if (!d.allow) expect(d.reason).toBe("channels_disabled");
  });

  it("default config blocks entity messages", () => {
    const d = evaluateOmadeusInboundPolicy({
      inbound: baseInbound({ subscribableKind: "task" }),
      omadeusCfg: {},
      selfReferenceId: selfRef,
    });
    expect(d.allow).toBe(false);
    if (!d.allow) expect(d.reason).toBe("entities_disabled");
  });

  it("honors direct sender allowlist", () => {
    const cfg: OmadeusChannelConfig = {
      inbound: {
        direct: { enabled: true, allowedSenderReferenceIds: [201], requireMention: "never" },
      },
    };
    const denied = evaluateOmadeusInboundPolicy({
      inbound: baseInbound({ subscribableKind: "direct", fromReferenceId: 200 }),
      omadeusCfg: cfg,
      selfReferenceId: selfRef,
    });
    expect(denied.allow).toBe(false);

    const ok = evaluateOmadeusInboundPolicy({
      inbound: baseInbound({ subscribableKind: "direct", fromReferenceId: 201 }),
      omadeusCfg: cfg,
      selfReferenceId: selfRef,
    });
    expect(ok.allow).toBe(true);
  });

  it("channel outsideAllowlist: no mention in allowlisted room", () => {
    const cfg: OmadeusChannelConfig = {
      inbound: {
        channels: {
          enabled: true,
          allowedRoomIds: [10],
          allowedSenderReferenceIds: [200],
          requireMention: "outsideAllowlist",
        },
      },
    };
    const d = evaluateOmadeusInboundPolicy({
      inbound: baseInbound({ subscribableKind: "channel", roomId: 10, isMention: false }),
      omadeusCfg: cfg,
      selfReferenceId: selfRef,
    });
    expect(d.allow).toBe(true);
  });

  it("channel outsideAllowlist: mention required outside room", () => {
    const cfg: OmadeusChannelConfig = {
      inbound: {
        channels: {
          enabled: true,
          allowedRoomIds: [10],
          allowedSenderReferenceIds: [200],
          requireMention: "outsideAllowlist",
        },
      },
    };
    const denied = evaluateOmadeusInboundPolicy({
      inbound: baseInbound({ subscribableKind: "channel", roomId: 99, isMention: false }),
      omadeusCfg: cfg,
      selfReferenceId: selfRef,
    });
    expect(denied.allow).toBe(false);

    const ok = evaluateOmadeusInboundPolicy({
      inbound: baseInbound({ subscribableKind: "channel", roomId: 99, isMention: true }),
      omadeusCfg: cfg,
      selfReferenceId: selfRef,
    });
    expect(ok.allow).toBe(true);
  });

  it("entities: disallowed kind", () => {
    const cfg: OmadeusChannelConfig = {
      inbound: {
        entities: {
          enabled: true,
          allowedKinds: ["task"],
          allowedSenderReferenceIds: [200],
          requireMention: "never",
        },
      },
    };
    const d = evaluateOmadeusInboundPolicy({
      inbound: baseInbound({ subscribableKind: "project" }),
      omadeusCfg: cfg,
      selfReferenceId: selfRef,
    });
    expect(d.allow).toBe(false);
    if (!d.allow) expect(d.reason).toBe("entity_kind_not_allowed");
  });

  it("entities: summary kind allowed when default entity set applies", () => {
    const cfg: OmadeusChannelConfig = {
      inbound: {
        entities: {
          enabled: true,
          allowedSenderReferenceIds: [200],
          requireMention: "always",
        },
      },
    };
    const d = evaluateOmadeusInboundPolicy({
      inbound: baseInbound({ subscribableKind: "summary", isMention: true }),
      omadeusCfg: cfg,
      selfReferenceId: selfRef,
    });
    expect(d.allow).toBe(true);
  });

  it("entities: allowed kind with requireMention always", () => {
    const cfg: OmadeusChannelConfig = {
      inbound: {
        entities: {
          enabled: true,
          allowedKinds: ["task"],
          allowedSenderReferenceIds: [200],
          requireMention: "always",
        },
      },
    };
    const denied = evaluateOmadeusInboundPolicy({
      inbound: baseInbound({ subscribableKind: "task", isMention: false }),
      omadeusCfg: cfg,
      selfReferenceId: selfRef,
    });
    expect(denied.allow).toBe(false);

    const ok = evaluateOmadeusInboundPolicy({
      inbound: baseInbound({ subscribableKind: "task", isMention: true }),
      omadeusCfg: cfg,
      selfReferenceId: selfRef,
    });
    expect(ok.allow).toBe(true);
  });
});
