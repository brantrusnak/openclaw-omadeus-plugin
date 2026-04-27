# OpenClaw Omadeus Plugin

Omadeus channel plugin for [OpenClaw](https://www.npmjs.com/package/openclaw).

This plugin connects OpenClaw to Omadeus over WebSocket so OpenClaw can listen
for Omadeus messages and reply through the selected Omadeus channel.

## Requirements

- Node.js 22 or newer
- OpenClaw 2026.4.10 or newer
- An Omadeus account with access to the organization and channel you want
  OpenClaw to use

## Install

Install OpenClaw first:

```bash
npm install -g openclaw
```

Set up OpenClaw if you have not already:

```bash
openclaw onboard
```

Then install this plugin with the OpenClaw plugin command:

```bash
openclaw plugins install @brantrusnak/openclaw-omadeus
```

You can confirm OpenClaw discovered the plugin with:

```bash
openclaw plugins list
openclaw plugins inspect omadeus
```

## Configure

After installing the plugin, run OpenClaw configuration and choose Omadeus when
prompted:

```bash
openclaw configure
```

The Omadeus setup flow asks for:

- Omadeus email and password
- Organization ID
- The Omadeus member/account to listen as
- The Omadeus channel to use for messages

The plugin also supports these environment variables:

```bash
export OMADEUS_EMAIL="you@example.com"
export OMADEUS_PASSWORD="your-password"
export OMADEUS_ORGANIZATION_ID="123"
```

The default Omadeus endpoints are:

- CAS: `https://dev1-cas.rouztech.com`
- Maestro: `https://dev3-maestro.rouztech.com`

If your Omadeus deployment uses different endpoints, configure them through the
OpenClaw setup flow or in your OpenClaw config under `channels.omadeus`.

## Start OpenClaw

Once OpenClaw and the plugin are configured, start or restart the gateway:

```bash
openclaw gateway
```

Check channel health with:

```bash
openclaw channels status --deep
openclaw plugins doctor
```

## Local Development

From this repository, you can link the local plugin into OpenClaw:

```bash
openclaw plugins install . --link
```

Before publishing, inspect the npm package contents:

```bash
npm pack --dry-run
```

Publish to npm:

```bash
npm publish
```
