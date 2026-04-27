import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";
import type { PluginRuntime } from "../runtime-api.js";

const { setRuntime: setOmadeusRuntime, getRuntime: getOmadeusRuntime } =
  createPluginRuntimeStore<PluginRuntime>("Omadeus runtime not initialized");

export { getOmadeusRuntime, setOmadeusRuntime };
