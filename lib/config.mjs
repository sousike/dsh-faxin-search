// 配置与路径：所有参数可通过环境变量覆盖，便于独立调试。
// 注意：本模块会被「DSH 主进程内嵌 (index.mjs/gateway)」和
// 「MCP stdio 子进程 (server/mcp-server.mjs)」两处加载，
// 因此这里必须保持纯 Node、无 DSH 依赖。
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PLUGIN_NAME = "dsh-faxin-search";
export const PLUGIN_VERSION = "0.1.0";

// MCP 命名空间：最终暴露给 agent 的工具名形如 mcp__faxin__search_law
export const MCP_SERVER_NAME = "faxin";
export const MCP_PROTOCOL_VERSION = "2025-06-18";

export function baseUrl(env = process.env) {
  return String(env.FAXIN_BASE_URL || "https://www.faxin.cn").replace(/\/+$/, "");
}

export function userAgent() {
  return (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
  );
}

export function requestTimeoutMs(env = process.env) {
  const n = Number(env.FAXIN_HTTP_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 30000;
}

export function maxResultsDefault(env = process.env) {
  const n = Number(env.FAXIN_MAX_RESULTS);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 50) : 20;
}

/** DSH 家目录：优先 DSH_HOME，其次用户主目录下的 .dsh */
export function dshHome(env = process.env) {
  return env.DSH_HOME || path.join(os.homedir(), ".dsh");
}

/**
 * 插件数据目录：会话 cookie 等持久化数据存放处。
 * 主进程（gateway/面板）与 MCP 子进程共用同一目录，经环境变量下发。
 */
export function dataDir(env = process.env) {
  const explicit = env.FAXIN_DATA_DIR;
  if (explicit) return explicit;
  // 支持常见布局：profiles/<name> 时放同级，否则直接放 dshHome 下
  return path.join(dshHome(env), "faxin-search");
}

export function sessionFilePath(env = process.env) {
  return path.join(dataDir(env), "session.json");
}

export function stateFilePath(env = process.env) {
  return path.join(dataDir(env), "state.json");
}

/** 注入给 MCP 子进程的最小环境子集 */
export function childEnv(env = process.env) {
  const pick = [
    "FAXIN_BASE_URL",
    "FAXIN_DATA_DIR",
    "FAXIN_HTTP_TIMEOUT_MS",
    "FAXIN_MAX_RESULTS",
    "DSH_HOME",
  ];
  const out = { ELECTRON_RUN_AS_NODE: "1" };
  for (const k of pick) {
    if (env[k] !== undefined && env[k] !== "") out[k] = env[k];
  }
  return out;
}

export const serverEntry = fileURLToPath(new URL("../server/mcp-server.mjs", import.meta.url));

/** Gateway 前缀：嵌入式登录入口。代理 www.faxin.cn 的同路径页面。 */
export const GATEWAY_PREFIX = "/faxin-gw";
export const API_PREFIX = "/faxin/api";
export const PANEL_PATH = "/faxin/panel.js";
export const PANEL_UI_PATH = "/faxin/panel-ui.html";
