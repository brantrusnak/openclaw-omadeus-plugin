# Omadeus Extension Notes

## Scope

- `extensions/omadeus` is a custom channel plugin modeled after OpenClaw channel extensions.
- Treat `extensions/msteams` as the best current reference for a modern channel plugin package shape.
- Read the repo-root `AGENTS.md` first, then this file.

## Fast Map

- `package.json`: plugin package metadata and OpenClaw discovery metadata.
- `index.ts`: current plugin entry. This still uses the older manual `register()` shape.
- `openclaw.plugin.json`: native plugin manifest and config schema.
- `src/channel.ts`: main `ChannelPlugin` definition.
- `src/runtime.ts`: runtime singleton setter/getter used by the plugin.
- `src/onboarding.ts`: setup flow and config patching.
- `src/message-handler.ts`: inbound access control, routing, and reply dispatch.
- `src/inbound.ts`: Jaguar message normalization and mention stripping.
- `src/outbound.ts`: Omadeus outbound sends.
- `src/socket/*`: Omadeus websocket clients.

## Current State

- Omadeus is a channel plugin, but it has not been migrated to the newer extension package conventions used by official plugins.
- It currently imports from the monolithic `openclaw/plugin-sdk` root in multiple files. Newer extension rules prefer focused `openclaw/plugin-sdk/<subpath>` imports.
- It does not yet expose the newer package surface used by official channel plugins:
  - `setup-entry.ts`
  - `api.ts`
  - `runtime-api.ts`
  - `defineChannelPluginEntry(...)` in `index.ts`
- `msteams`, `matrix`, `zalo`, and `synology-chat` are better references than older or ad hoc plugins.

## Best References

- `extensions/msteams/package.json`
- `extensions/msteams/index.ts`
- `extensions/msteams/setup-entry.ts`
- `extensions/msteams/api.ts`
- `extensions/msteams/runtime-api.ts`
- `src/plugin-sdk/core.ts`
- `docs/plugins/building-extensions.md`
- `docs/tools/plugin.md`
- `docs/plugins/architecture.md`

## Upgrade-Era Rules That Matter

- Prefer `defineChannelPluginEntry()` from `openclaw/plugin-sdk/core` for the default export in `index.ts`.
- If the plugin has channel setup/onboarding, add `setup-entry.ts` and wire `openclaw.setupEntry` in `package.json`.
- Keep extension-internal imports local. Do not import this extension back through a published SDK path from production code.
- Do not import core internals via `src/**`. Use focused `openclaw/plugin-sdk/<subpath>` entrypoints.
- Keep plugin-only runtime deps in this package. Do not add them to the repo root.
- Do not use `workspace:*` in `dependencies`. If local development needs an `openclaw` package reference, use `devDependencies` and/or `peerDependencies`.

## Practical Reading Order For Future Agents

1. `package.json`
2. `index.ts`
3. `src/channel.ts`
4. `src/onboarding.ts`
5. `src/message-handler.ts`
6. `src/inbound.ts` and `src/outbound.ts`
7. `extensions/msteams/{package.json,index.ts,setup-entry.ts,api.ts,runtime-api.ts}`
8. `docs/plugins/building-extensions.md`

## Suggested Work Order When Omadeus Needs Fixes

1. Normalize the package surface first.
2. Migrate root SDK imports to focused subpaths.
3. Add `setup-entry.ts` if setup/onboarding should work without loading the full runtime entry.
4. Only then fix Omadeus-specific runtime behavior.

This keeps upgrade work separate from channel behavior changes and makes failures easier to localize.

## Validation

- Prefer the narrowest validation that covers the changed behavior.
- Always run at least:
  - `pnpm check`
- If the change affects plugin loading, package metadata, lazy-loading, or public plugin surfaces, also run:
  - `pnpm build`

## Git Note

- `extensions/omadeus` is currently its own nested git repo.
- From the root repo, `git status` only shows `extensions/omadeus/` as a directory. To inspect plugin-local changes, use:
  - `git -C extensions/omadeus status`
