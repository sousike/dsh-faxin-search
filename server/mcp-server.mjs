#!/usr/bin/env node
// DSH faxin-search MCP stdio 服务端。
// 由 dsh-mcp-client 以「stdio transport」拉起（DSH Desktop 下自动以
// ELECTRON_RUN_AS_NODE 运行），实现最小 MCP JSON-RPC 子集：
// initialize / ping / notifications / tools.list / tools.call。
// 检索逻辑复用 lib/（纯 Node + 全局 fetch），会话 Cookie 与主进程 gateway
// 共用同一会话文件（FAXIN_DATA_DIR），实现「面板登录一次，工具带会话检索」。
import { createInterface } from "node:readline";
import { FaxinApi } from "../lib/api.mjs";
import { TOOL_DEFS, dispatchTool } from "../lib/tools.mjs";
import { PLUGIN_NAME, PLUGIN_VERSION, MCP_PROTOCOL_VERSION } from "../lib/config.mjs";

const api = new FaxinApi();

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function sendError(id, code, message) {
  send({ jsonrpc: "2.0", id: id === undefined ? null : id, error: { code, message } });
}

async function handleRequest(msg) {
  const { id, method, params } = msg;
  switch (method) {
    case "initialize": {
      const clientVersion = params && params.protocolVersion;
      const version =
        clientVersion && /^2024-/.test(clientVersion) ? clientVersion : MCP_PROTOCOL_VERSION;
      send({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: version,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: PLUGIN_NAME, version: PLUGIN_VERSION },
        },
      });
      return;
    }
    case "ping":
      send({ jsonrpc: "2.0", id, result: {} });
      return;
    case "resources/list":
      send({ jsonrpc: "2.0", id, result: { resources: [] } });
      return;
    case "resources/templates/list":
      send({ jsonrpc: "2.0", id, result: { resourceTemplates: [] } });
      return;
    case "prompts/list":
      send({ jsonrpc: "2.0", id, result: { prompts: [] } });
      return;
    case "tools/list": {
      const tools = TOOL_DEFS.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));
      send({ jsonrpc: "2.0", id, result: { tools } });
      return;
    }
    case "tools/call": {
      const name = params && params.name;
      const args = (params && params.arguments) || {};
      if (!name) return sendError(id, -32602, "missing tool name");
      try {
        const text = await dispatchTool(api, name, args);
        send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }], isError: false } });
      } catch (err) {
        send({
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: `执行失败：${err && err.message ? err.message : err}` }],
            isError: true,
          },
        });
      }
      return;
    }
    case "notifications/initialized":
    case "notifications/cancelled":
    case "notifications/roots/list_changed":
      return; // 通知无需应答
    case "logging/setLevel":
      send({ jsonrpc: "2.0", id, result: {} });
      return;
    default:
      if (method.startsWith("notifications/")) return;
      sendError(id, -32601, `unknown method: ${method}`);
  }
}

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return; // 忽略坏帧
  }
  if (!msg || typeof msg !== "object") return;
  if (msg.id === undefined || msg.id === null) return; // 通知
  handleRequest(msg).catch((err) => {
    sendError(msg.id, -32603, String((err && err.message) || err));
  });
});

rl.on("close", () => {
  process.exit(0);
});

process.stderr.write(`[faxin-mcp] ${PLUGIN_NAME} v${PLUGIN_VERSION} ready (pid ${process.pid})\n`);
