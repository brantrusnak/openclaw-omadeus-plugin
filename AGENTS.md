# Omadeus Plugin Agent Notes

## What This Repo Is

- `@brantrusnak/openclaw-omadeus` is an OpenClaw channel plugin for Omadeus.
- Runtime chat uses Jaguar, data events use Dolphin, and REST helpers live under `src/api`.
- The package already uses the modern OpenClaw plugin surface: `index.ts`, `setup-entry.ts`, `api.ts`, and `runtime-api.ts`.

## Key Files

- `package.json`: npm metadata, OpenClaw discovery metadata, package files, and scripts.
- `openclaw.plugin.json`: channel config schema and UI hints.
- `index.ts`: runtime entry using `defineChannelPluginEntry(...)`.
- `setup-entry.ts`: setup-only entry using `defineSetupPluginEntry(...)`.
- `runtime-api.ts`: focused SDK re-export boundary for plugin internals.
- `src/channel.ts`: main `ChannelPlugin` definition, actions, config adapter, outbound adapter, status, and gateway startup.
- `src/config.ts`: account/config resolution and defaults.
- `src/setup-core.ts`, `src/setup-surface.ts`, `src/onboarding.ts`: setup/configuration flow.
- `src/inbound.ts`, `src/message-handler.ts`, `src/reply-dispatcher.ts`, `src/outbound.ts`: receive, route, reply, and send flow.
- `src/token.ts`, `src/socket/*`, `src/api/*`: auth refresh, WebSocket clients, and Omadeus REST calls.

## Local Rules

- Keep OpenClaw imports on focused `openclaw/plugin-sdk/<subpath>` entrypoints or through `runtime-api.ts`; do not import from the monolithic `openclaw/plugin-sdk` root or OpenClaw `src/**` internals.
- Keep plugin-only runtime dependencies in this package. `openclaw` belongs in `peerDependencies` and `devDependencies`, not `dependencies`.
- If adding public entry files, update `package.json.files` and `scripts/verify-npm-files.mjs`.
- Treat `package.json` `openclaw` metadata and `openclaw.plugin.json` as public plugin surface.
- Do not layer compatibility around unshipped branch-local shapes; keep the standalone package clean.

## Behavior Notes

- `send` targets Omadeus room ids: `room:123` or `123`. Task-like targets such as `N123`/`T123` may be resolved to a room by `src/nugget-lookup.ts`.
- `edit`, `delete`, and `react` use Jaguar message ids, not room ids. Current inbound messages expose that id as `MessageSid`.
- Reactions are restricted by `src/allowed-reaction-emojis.ts`; unsupported emoji are ignored with a successful structured result.
- Setup writes `channels.omadeus` and can use `OMADEUS_EMAIL`, `OMADEUS_PASSWORD`, and `OMADEUS_ORGANIZATION_ID`.

## Validation

- Run `pnpm test` or `npm test` for behavior changes.
- Run `npm run prepack` or `npm pack --dry-run` when package files, entrypoints, or publish surface change.
- Prefer focused tests near the changed module; avoid broad refactors while fixing Omadeus behavior.
