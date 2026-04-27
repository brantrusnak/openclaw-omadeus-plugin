import { defineChannelPluginEntry } from "openclaw/plugin-sdk/core";
import { omadeusPlugin } from "./src/channel.js";
import { setOmadeusRuntime } from "./src/runtime.js";

export { omadeusPlugin } from "./src/channel.js";
export { setOmadeusRuntime } from "./src/runtime.js";

export default defineChannelPluginEntry({
  id: "omadeus",
  name: "Omadeus",
  description: "Omadeus project management channel plugin",
  plugin: omadeusPlugin,
  setRuntime: setOmadeusRuntime,
});
