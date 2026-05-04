# OpenClaw Omadeus Plugin

[![Socket Badge](https://badge.socket.dev/npm/package/@brantrusnak/openclaw-omadeus)](https://badge.socket.dev/npm/package/@brantrusnak/openclaw-omadeus)
[![CI](https://github.com/brantrusnak/openclaw-omadeus-plugin/actions/workflows/npm-publish.yml/badge.svg)](https://github.com/brantrusnak/openclaw-omadeus-plugin/actions/workflows/npm-publish.yml)
[![npm version](https://img.shields.io/npm/v/@brantrusnak/openclaw-omadeus)](https://www.npmjs.com/package/@brantrusnak/openclaw-omadeus)
[![License: ISC](https://img.shields.io/npm/l/@brantrusnak/openclaw-omadeus)](https://www.npmjs.com/package/@brantrusnak/openclaw-omadeus)

[Omadeus](https://omadeus.com) plugin for [OpenClaw](https://www.npmjs.com/package/openclaw).

## Requirements

- Node.js 22 or newer
- OpenClaw 2026.4.10 or newer
- An Omadeus account

## Install

```bash
npm install -g openclaw
openclaw plugins install @brantrusnak/openclaw-omadeus
```

Verify the plugin was installed:

```bash
openclaw plugins list
```

Then run setup:

```bash
openclaw onboard
```

## Configure

```bash
openclaw configure
```

You can also set credentials via environment variables:

```bash
export OMADEUS_EMAIL="you@example.com"
export OMADEUS_PASSWORD="your-password"
export OMADEUS_ORGANIZATION_ID="123"
```

## Start

```bash
openclaw gateway
```

## Local Development

```bash
npm install
npm run build
openclaw plugins install . --link
```
