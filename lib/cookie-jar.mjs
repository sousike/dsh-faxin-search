// 极简 RFC6265 Cookie 罐：JSON 持久化（原子写入），
// 供 gateway(主进程) 与 MCP 子进程共享同一会话文件。
import fs from "node:fs";
import path from "node:path";
import { sessionFilePath } from "./config.mjs";

function parseSetCookieHeader(line) {
  const parts = String(line || "").split(";");
  const first = parts.shift() || "";
  const eq = first.indexOf("=");
  if (eq <= 0) return null;
  const name = first.slice(0, eq).trim();
  const value = first.slice(eq + 1).trim();
  if (!name) return null;
  const cookie = { name, value, domain: "", path: "/", expires: null, secure: false, httpOnly: false, hostOnly: true };
  for (const raw of parts) {
    const seg = raw.trim();
    const i = seg.indexOf("=");
    const key = (i === -1 ? seg : seg.slice(0, i)).trim().toLowerCase();
    const val = (i === -1 ? "" : seg.slice(i + 1)).trim();
    if (key === "domain") {
      let d = val.replace(/^\./, "").toLowerCase();
      if (d) {
        cookie.domain = d;
        cookie.hostOnly = false;
      }
    } else if (key === "path") {
      if (val) cookie.path = val;
    } else if (key === "expires") {
      const t = Date.parse(val);
      if (!Number.isNaN(t)) cookie.expires = Math.floor(t / 1000);
    } else if (key === "max-age") {
      const n = Number(val);
      if (Number.isFinite(n)) cookie.expires = Math.floor(Date.now() / 1000) + n;
    } else if (key === "secure") {
      cookie.secure = true;
    } else if (key === "httponly") {
      cookie.httpOnly = true;
    } else if (key === "samesite") {
      cookie.sameSite = val;
    }
  }
  return cookie;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function hostMatches(hostname, cookie) {
  const h = String(hostname).toLowerCase();
  if (cookie.hostOnly) return h === cookie.domain.toLowerCase();
  const d = cookie.domain.toLowerCase();
  return h === d || h.endsWith("." + d);
}

function pathMatches(reqPath, cookiePath) {
  const p = cookiePath || "/";
  if (p === "/") return true;
  return reqPath === p || reqPath.startsWith(p.endsWith("/") ? p : p + "/");
}

function isExpired(cookie, nowSec) {
  return cookie.expires !== null && cookie.expires <= nowSec;
}

export class CookieJar {
  constructor(filePath = sessionFilePath(process.env), { logger = null } = {}) {
    this.filePath = filePath;
    this.logger = logger;
    this.cookies = [];
    this._dirty = false;
    this.load();
  }

  load() {
    try {
      const text = fs.readFileSync(this.filePath, "utf8");
      const data = JSON.parse(text);
      if (Array.isArray(data)) this.cookies = data;
      else if (data && Array.isArray(data.cookies)) this.cookies = data.cookies;
    } catch {
      this.cookies = [];
    }
    this._dirty = false;
    return this;
  }

  /** 原子落盘；失败仅记录不抛出（检索不应被磁盘问题打断）。 */
  save() {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tmp = this.filePath + ".tmp";
      fs.writeFileSync(
        tmp,
        JSON.stringify(
          { version: 1, updatedAt: new Date().toISOString(), cookies: this.cookies },
          null,
          2,
        ),
        "utf8",
      );
      fs.renameSync(tmp, this.filePath);
      this._dirty = false;
      return true;
    } catch (err) {
      this.logger?.warn?.(`faxin cookie save failed: ${err?.message || err}`);
      return false;
    }
  }

  clear() {
    this.cookies = [];
    this._dirty = true;
    return this.save();
  }

  cookieCount() {
    return this.cookies.length;
  }

  /** 会话内有效 cookie 数（是否疑似已登录的依据之一） */
  liveCount(now = Date.now()) {
    const nowSec = Math.floor(now / 1000);
    return this.cookies.filter((c) => !isExpired(c, nowSec)).length;
  }

  // —— 写入 ——
  store(setCookieHeaders, requestUrl) {
    if (!setCookieHeaders) return;
    const list = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
    const url = new URL(requestUrl);
    const nowSec = Math.floor(Date.now() / 1000);
    let changed = false;
    for (const raw of list) {
      const c = parseSetCookieHeader(raw);
      if (!c) continue;
      if (isExpired(c, nowSec)) {
        this._remove(url.hostname, c.name, c.domain, c.path);
        changed = true;
        continue;
      }
      if (!c.domain) c.domain = url.hostname.toLowerCase();
      this._upsert(c);
      changed = true;
    }
    if (changed) {
      this._dirty = true;
      this.save();
    }
  }

  _upsert(cookie) {
    const idx = this.cookies.findIndex(
      (c) =>
        c.name === cookie.name &&
        c.domain.toLowerCase() === cookie.domain.toLowerCase() &&
        c.path === cookie.path,
    );
    if (idx === -1) this.cookies.push(cookie);
    else this.cookies[idx] = cookie;
  }

  _remove(hostname, name, domain, cpath) {
    const dom = (domain && String(domain).replace(/^\./, "").toLowerCase()) || String(hostname).toLowerCase();
    this.cookies = this.cookies.filter(
      (c) => !(c.name === name && c.domain.toLowerCase() === dom && c.path === cpath),
    );
  }

  // —— 读取 ——
  /** 返回按 RFC6265 匹配 url 的 Cookie 头值（name=value; ...）。先重读文件保持与 gateway 一致。 */
  headerFor(url) {
    this.load();
    let u;
    try {
      u = new URL(url);
    } catch {
      return "";
    }
    const nowSec = Math.floor(Date.now() / 1000);
    const p = u.pathname || "/";
    const parts = [];
    for (const c of this.cookies) {
      if (isExpired(c, nowSec)) continue;
      if (c.secure && u.protocol !== "https:") continue;
      if (!hostMatches(u.hostname, c)) continue;
      if (!pathMatches(p, c.path)) continue;
      parts.push(`${c.name}=${c.value}`);
    }
    return parts.join("; ");
  }

  /** 供展示/导出 */
  headerSummary() {
    this.load();
    const nowSec = Math.floor(Date.now() / 1000);
    return this.cookies
      .filter((c) => !isExpired(c, nowSec) && /faxin/i.test(c.domain))
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
  }

  /** 由用户粘贴的 Cookie 头（k=v; k2=v2 或 Netscape 行）批量导入，覆盖写入。 */
  importHeader(headerText) {
    const text = String(headerText || "");
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    let pairs = [];
    for (const line of lines) {
      if (line.startsWith("#")) continue;
      if (/^[a-zA-Z0-9_.-]+\t/.test(line)) {
        // Netscape/HTTP 浏览器导出格式：domain\tflag\tpath\tsecure\texpiry\tname\tvalue
        const t = line.split("\t");
        if (t.length >= 7) {
          pairs.push({
            name: t[5].trim(),
            value: t[6].trim(),
            domain: t[0].trim().replace(/^\./, "").toLowerCase() || "",
            path: t[2] || "/",
            expires: /^\d+$/.test(t[4]) ? Number(t[4]) : null,
            secure: String(t[3]) === "TRUE",
            httpOnly: false,
            hostOnly: false,
          });
          continue;
        }
      }
      // Cookie 请求头形态
      for (const seg of line.split(/[;,]/)) {
        const i = seg.indexOf("=");
        if (i > 0) pairs.push({ name: seg.slice(0, i).trim(), value: seg.slice(i + 1).trim() });
      }
    }
    if (pairs.length === 0) return { ok: false, count: 0, error: "未能从输入解析出任何 Cookie" };
    // 覆盖式导入：先清空 faxin 域旧 cookie 再写入
    const faxinDomains = ["faxin.cn", "wenshu.faxin.cn", "rmfyalk.faxin.cn", "sfb-vip.faxin.cn", "bz.faxin.cn"];
    this.cookies = this.cookies.filter((c) => !faxinDomains.some((d) => c.domain === d || c.domain.endsWith("." + d)));
    for (const p of pairs) {
      if (!p.domain) p.domain = "faxin.cn"; // Cookie 头形态无域信息 → 按 .faxin.cn 全域处理
      p.domain = p.domain.replace(/^\./, "").toLowerCase();
      p.path = p.path || "/";
      p.hostOnly = false;
      this._upsert(p);
    }
    this._dirty = true;
    this.save();
    return { ok: true, count: pairs.length };
  }
}
