# Omadeus Plugin Flow

This document explains how `extensions/omadeus` integrates with OpenClaw, how messages flow in and out, and where to add custom actions later.

## 1) How OpenClaw Loads The Plugin

OpenClaw discovers the Omadeus extension from `extensions/omadeus/package.json`:

- `openclaw.extensions` points to `./index.ts`
- `openclaw.setupEntry` points to `./setup-entry.ts`

Entry files:

- `extensions/omadeus/index.ts`
  - uses `defineChannelPluginEntry(...)`
  - exports `omadeusPlugin` and `setOmadeusRuntime`
- `extensions/omadeus/setup-entry.ts`
  - uses `defineSetupPluginEntry(omadeusPlugin)`

The runtime setter in `extensions/omadeus/src/runtime.ts` stores OpenClaw runtime services so Omadeus code can use shared routing/session/reply helpers.

### TL;DR

- OpenClaw loads Omadeus via `package.json` metadata.
- `index.ts` registers channel behavior.
- `setup-entry.ts` registers setup behavior.
- Runtime is injected once and read from `src/runtime.ts`.

## 2) Main Plugin Contract

The plugin definition lives in `extensions/omadeus/src/channel.ts` as `omadeusPlugin`.

OpenClaw calls standardized sections on this object:

- `config` for account resolution and config rendering
- `security` for DM policy decisions
- `setup` + `setupWizard` for onboarding and configuration UX
- `outbound` for sending messages to Omadeus
- `gateway.startAccount` to start sockets and processing
- `actions` for message-tool action discovery/handling
- `status` for health snapshots and diagnostics

### TL;DR

- `src/channel.ts` is the control center.
- OpenClaw does not use Omadeus through one-off calls; it uses plugin hooks.

## 3) Receive Flow (Omadeus -> OpenClaw Agent)

High-level receive sequence:

1. `gateway.startAccount` runs in `extensions/omadeus/src/channel.ts`.
2. Auth starts through `extensions/omadeus/src/token.ts` (`createTokenManager`).
3. Sockets connect:
   - Jaguar chat socket: `extensions/omadeus/src/socket/jaguar.socket.ts`
   - Dolphin data socket: `extensions/omadeus/src/socket/dolphin.socket.ts`
4. Jaguar chat events are parsed by `extensions/omadeus/src/inbound.ts`:
   - drops non-message payloads
   - drops removed/self messages (depending on config)
   - detects mention tokens
   - strips mention prefix before agent processing
5. Parsed inbound events are processed by `extensions/omadeus/src/message-handler.ts`:
   - DM/group access checks + pairing behavior
   - control-command gate checks
   - route resolution (`sessionKey`, `agentId`)
   - context/envelope construction
   - dispatch into OpenClaw reply pipeline

Important: Omadeus inbound messages are transformed into OpenClaw context payloads before the agent sees them.

### TL;DR

- Sockets receive raw events.
- `inbound.ts` normalizes Omadeus data.
- `message-handler.ts` does policy/routing/session wiring.
- Final dispatch goes through OpenClaw's standard reply runtime.

## 4) Send Flow (OpenClaw Agent -> Omadeus)

High-level send sequence:

1. Agent replies are handled by `extensions/omadeus/src/reply-dispatcher.ts`.
2. Replies are chunked (configured text limits + mode).
3. Each chunk calls `sendOmadeusMessage(...)`.
4. `extensions/omadeus/src/outbound.ts` sends through Omadeus API (`sendRoomMessage`).
5. Result metadata is returned to OpenClaw.

`outbound.resolveTarget` in `extensions/omadeus/src/channel.ts` ensures a valid target exists (`<roomId>`).

### TL;DR

- Reply dispatcher formats/chunks replies.
- Outbound adapter sends each chunk via Omadeus API.
- Target validation happens before sending.

## 5) Setup And Onboarding Flow

Files:

- `extensions/omadeus/src/setup-core.ts`
  - low-level setup adapter (field parsing + config writes)
- `extensions/omadeus/src/onboarding.ts`
  - interactive wizard, auth checks, organization lookup, DM policy prompts
- `extensions/omadeus/src/setup-surface.ts`
  - setup surface export (`omadeusSetupWizard`)

The setup path can use env vars (`OMADEUS_EMAIL`, `OMADEUS_PASSWORD`, `OMADEUS_ORGANIZATION_ID`) or explicit prompt-driven credentials.

### TL;DR

- `setup-core.ts` = core config write behavior.
- `onboarding.ts` = user-facing setup logic.
- `setup-surface.ts` = exported setup surface used by OpenClaw.

## 6) Actions: Current State

Actions are declared under `actions` in `extensions/omadeus/src/channel.ts`.

Current behavior:

- `describeMessageTool` advertises `["send", "edit", "delete", "react"]` when Omadeus is enabled and configured.
- `handleAction` implements **`react`** via `addMessageReaction` in `extensions/omadeus/src/api/message.api.ts` (Jaguar REST). Other actions fall through to defaults where applicable.
- **Reactions** are limited to 👍 👎 ❤️ 😂 😮 😢 🙏 (see `extensions/omadeus/src/allowed-reaction-emojis.ts`). Any other emoji returns success with `ignored: true` and does **not** call the API.
- Inbound messages set `MessageSid` on the agent context to the Jaguar **`messageId`**, so the shared message tool can default `react` to the current message without passing `messageId`.
- Conversation routing uses `To` / `OriginatingTo` like `room:<roomId>`. The plugin **`messaging.targetResolver`** normalizes that to the numeric **room id** so core target resolution accepts it (reactions still use **`messageId`** via REST, not the room id in the API path).

### TL;DR

- **react**: `emoji` required (only the allowed set above); `messageId` optional if replying in the same conversation thread (uses inbound `MessageSid`).
- **send / edit / delete**: discovery listed; plugin-specific handling can be extended in `handleAction` like `react`.

## 7) How To Add More Actions Later

Use this process when adding custom Omadeus actions:

1. **Advertise the action**
   - Update `actions.describeMessageTool` in `extensions/omadeus/src/channel.ts`.
   - Add action name(s), and add `schema` if params are needed.

2. **Implement handler logic**
   - Branch by `ctx.action` in `actions.handleAction`.
   - Validate params early.
   - Call Omadeus API/socket helper(s) in `extensions/omadeus/src/api/*` or helper modules.
   - Return structured result payloads (success and error).

3. **Preserve fallback behavior**
   - For unsupported actions, keep returning `null as never`.

4. **Add tests**
   - Add focused tests around discovery + handler behavior.
   - Validate both success and parameter/error paths.

5. **Keep boundaries clean**
   - Prefer plugin-local imports and `runtime-api.ts` boundary exports for shared SDK types/helpers.

### TL;DR

- Add action in `describeMessageTool`.
- Implement it in `handleAction`.
- Keep fallback for unknown actions.
- Add targeted tests.

## Omadeus IDs (plain English)

| What | Jaguar field | OpenClaw usage |
|------|----------------|-----------------|
| **Chat / DM / room** | `roomId` | **send** uses `to` / `target` as `room:<id>` or numeric id (where the message is posted). |
| **One chat line** | `id` on the message object | **edit**, **delete**, **react** use **`messageId`** (also exposed as inbound **`MessageSid`** for the current message). |

Sending never uses the message `id` as the destination; it uses **roomId**. Editing/deleting/reacting never use roomId as the primary key; they use **message id**.

## One-Page TL;DR

- OpenClaw loads Omadeus from `package.json` -> `index.ts` / `setup-entry.ts`.
- `src/channel.ts` is the plugin contract OpenClaw executes.
- Receive path: socket event -> normalize (`inbound.ts`) -> policy/routing (`message-handler.ts`) -> agent dispatch.
- Send path: reply dispatcher (`reply-dispatcher.ts`) -> chunk -> API send (`outbound.ts`).
- Setup path: `setup-core.ts` + `onboarding.ts` + `setup-surface.ts`.
- Actions are discoverable today, but custom execution is still mostly TODO.
- To add actions: update `describeMessageTool`, implement `handleAction`, add tests.

## 8) Socket Heartbeat Contract

Omadeus sockets use an app-level heartbeat in `extensions/omadeus/src/socket/socket.ts`.

- **Sent by OpenClaw sockets**: `{"data":"keep-alive","action":"answer"}`
- **Expected from backend**: `{"content":"keep-alive","action":"answer"}`

Behavior:

1. On socket open, send heartbeat immediately.
2. Send heartbeat every `HEARTBEAT_INTERVAL_MS` (default 30s).
3. Reset missed-heartbeat counter when backend answer arrives.
4. If missed count reaches `HEARTBEAT_MISSED_MAX` (default 5), close socket to force reconnect.

Tuning constants:

- `HEARTBEAT_INTERVAL_MS` (default `30_000`)
- `HEARTBEAT_MISSED_MAX` (default `5`)

### TL;DR

- Immediate heartbeat on connect + periodic heartbeats.
- Counter resets only when backend sends keep-alive answer.
- Too many misses triggers reconnect automatically.
