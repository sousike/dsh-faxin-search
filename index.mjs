// dsh-faxin-search —— DSH 客户端插件主入口
// 组成：
//  1) webServer 路由：/faxin-gw/*  法信官网反向网关（面板内完成一次登录，
//     会话 Cookie 被本机吸收，供所有检索工具复用）
//  2) webServer 路由：/faxin/api/* 状态 / Cookie 导入 / 结构化快速检索
//  3) tapIndex 注入 /faxin/panel.js：左下角浮标 + 登录/检索面板
//  4) ctx.plugin(mcp-client, …)：把 faxin_* 检索工具挂到 agent 工具集
//     （公共名 mcp__faxin__search_law 等）
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import * as mcpClient from "@deepseek-ai/dsh-mcp-client";
import { CookieJar } from "./lib/cookie-jar.mjs";
import { FaxinApi } from "./lib/api.mjs";
import { createGatewayHandler } from "./lib/gateway.mjs";
import {
  GATEWAY_PREFIX,
  API_PREFIX,
  PANEL_PATH,
  PLUGIN_NAME,
  PLUGIN_VERSION,
  childEnv,
  serverEntry,
} from "./lib/config.mjs";

export const name = "faxin-search";
export const inject = ["webServer"];

const PANEL_FILE = fileURLToPath(new URL("./panel/client.js", import.meta.url));

function readBody(req, limit = 1 << 20) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function json(res, status, obj) {
  const text = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(text);
}

function errText(err) {
  return (err && err.message) || String(err);
}

export function apply(ctx) {
  const disposers = [];
  const jar = new CookieJar(undefined, { logger: ctx.logger });
  const api = new FaxinApi({ jar });

  // —— 1) 登录网关 ——
  disposers.push(
    ctx.webServer.register({
      kind: "prefix",
      path: GATEWAY_PREFIX,
      handler: createGatewayHandler({ jar, logger: ctx.logger, prefix: GATEWAY_PREFIX }),
    }),
  );

  // —— 2) API ——
  disposers.push(
    ctx.webServer.register({
      kind: "exact",
      path: `${API_PREFIX}/status`,
      handler: async (req, res) => {
        try {
          const force = /[?&]force=1/.test(req.url || "");
          const r = await api.checkLogin({ force });
          json(res, 200, {
            ok: r.ok,
            diag: r.diag || "",
            hasCookies: !!r.hasCookies,
            liveCount: r.liveCount || 0,
            version: PLUGIN_VERSION,
            gateway: GATEWAY_PREFIX,
            plugin: PLUGIN_NAME,
          });
        } catch (err) {
          json(res, 500, { ok: false, error: errText(err) });
        }
      },
    }),
  );

  disposers.push(
    ctx.webServer.register({
      kind: "exact",
      path: `${API_PREFIX}/cookies`,
      handler: async (req, res) => {
        try {
          const method = String(req.method || "GET").toUpperCase();
          if (method === "GET") {
            json(res, 200, { ok: true, liveCount: jar.liveCount() });
            return;
          }
          if (method === "DELETE") {
            api.clearCookies();
            json(res, 200, { ok: true, liveCount: 0 });
            return;
          }
          if (method === "POST") {
            const body = await readBody(req);
            let parsed = {};
            try {
              parsed = JSON.parse(body || "{}");
            } catch {
              json(res, 400, { ok: false, error: "JSON 解析失败" });
              return;
            }
            const r = api.importCookies(String(parsed.cookie_header || ""));
            json(res, r.ok ? 200 : 400, r);
            return;
          }
          json(res, 405, { ok: false, error: `method ${method} not allowed` });
        } catch (err) {
          json(res, 500, { ok: false, error: errText(err) });
        }
      },
    }),
  );

  disposers.push(
    ctx.webServer.register({
      kind: "exact",
      path: `${API_PREFIX}/search`,
      handler: async (req, res) => {
        let p = {};
        try {
          const body = await readBody(req, 2 << 20);
          p = JSON.parse(body || "{}");
        } catch (err) {
          json(res, 400, { ok: false, error: errText(err) });
          return;
        }
        const kind = String(p.kind || "");
        const max = Math.min(50, Math.max(1, Number(p.max_results) || 20));
        try {
          let data;
          switch (kind) {
            case "law":
              data = await api.searchLaw({
                keyword: String(p.keyword || ""),
                timeliness: String(p.timeliness || ""),
                lib: String(p.lib || "all"),
                maxResults: max,
              });
              break;
            case "case":
              data = await api.searchCases({ keyword: String(p.keyword || ""), maxResults: max });
              break;
            case "lib":
              data = await api.searchLib({
                keyword: String(p.keyword || ""),
                lib: String(p.lib || ""),
                maxResults: max,
              });
              break;
            case "tiao":
              data = await api.getTiao(p.law, p.tiao);
              break;
            case "outline":
              data = await api.searchOutline(
                String(p.keyword || ""),
                Math.min(20, Math.max(1, Number(p.max_results) || 10)),
              );
              break;
            case "detail":
              data = await api.getDetail(String(p.gid || ""), String(p.tiao || ""));
              break;
            default:
              json(res, 400, { ok: false, error: `未知 kind: ${kind}` });
              return;
          }
          json(res, 200, { ok: true, kind, data });
        } catch (err) {
          json(res, 200, { ok: false, error: errText(err) });
        }
      },
    }),
  );

  // —— 3) 面板脚本注入 ——
  disposers.push(
    ctx.webServer.register({
      kind: "exact",
      path: PANEL_PATH,
      handler: (req, res) => {
        let js;
        try {
          js = fs.readFileSync(PANEL_FILE, "utf8");
        } catch (err) {
          res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("panel script unavailable: " + errText(err));
          return;
        }
        res.writeHead(200, {
          "Content-Type": "application/javascript; charset=utf-8",
          "Cache-Control": "no-store",
        });
        res.end(js);
      },
    }),
  );

  disposers.push(
    ctx.webServer.tapIndex((html) => {
      if (html.includes(PANEL_PATH)) return html;
      const tag = `<script defer src="${PANEL_PATH}"></script>`;
      if (html.includes("</body>")) return html.replace("</body>", tag + "</body>");
      return html + tag;
    }),
  );

  ctx.effect(() => () => {
    for (const d of disposers) {
      try {
        d();
      } catch {
        /* ignore */
      }
    }
  }, `${PLUGIN_NAME}.dispose`);

  // —— 4) MCP 工具桥（放最后，不阻塞启动；@deepseek-ai/dsh-mcp-client 由宿主提供） ——
  ctx.plugin(mcpClient, {
    transport: "stdio",
    serverName: "faxin",
    command: process.execPath,
    args: [serverEntry],
    env: childEnv(process.env),
    toolCallTimeoutMs: 120000,
    failOnStartupError: false,
  });
}
