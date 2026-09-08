// www.faxin.cn 的反向网关：把用户浏览/登录流量经本机 DSH webServer
// 转发到法信官网，同时把官网 Set-Cookie 全部吸收进本地会话 Cookie 罐。
// 登录由用户在嵌入面板的页面上用「自己的法信账号」手动完成
// （密码只提交给 www.faxin.cn，本机不落盘），验证码等照常在页面完成；
// 之后所有检索工具直接复用罐内会话。浏览器侧无需任何 Cookie。
import { baseUrl, requestTimeoutMs, userAgent } from "./config.mjs";

const MAX_BODY = 8 * 1024 * 1024; // POST body 上限（登录 viewstate 通常 < 100KB）
const MAX_HTML = 40 * 1024 * 1024; // HTML 缓冲上限（重写需要）

function rewriteHtml(html, prefix) {
  let s = html;
  // 1) 绝对/协议相对的法信地址 → 网关前缀（保留路径）
  s = s.replace(/https?:\/\/www\.faxin\.cn\//gi, prefix + "/");
  s = s.replace(/https?:\/\/faxin\.cn\//gi, prefix + "/");
  s = s.replace(/(["'\s])?\/\/www\.faxin\.cn\//g, "$1" + prefix + "/");
  // 2) 根相对路径属性 → 网关前缀（保持同源，避免落到 DSH 自身根路径）
  s = s.replace(
    /(\b(?:href|src|action|poster|data-src|codebase|cite)\s*=\s*["'])\/(?!\/|faxin-gw\/)/gi,
    `$1${prefix}/`,
  );
  // 3) JS/字符串里的常见法信内部路径前缀（登录/检索页多为回发或固定 API）
  s = s.replace(
    /(["'`])\/(alllibsearch|keyword|lib|v2|staticelem|src|image|Regist|FindPwd|user|html|GSPage|search|GSPage)\//gi,
    `$1${prefix}/$2/`,
  );
  // 4) ASP.NET 回发目标（.NET 会写 doPostBack 的 action）
  s = s.replace(
    /(name=["']__EVENTTARGET["']|href=["']javascript:__doPostBack)/gi,
    (m) => m,
  );
  return s;
}

function rewriteLocation(location, prefix, upstream) {
  const loc = String(location || "");
  if (!loc) return loc;
  if (/^https?:\/\//i.test(loc)) {
    const u = new URL(loc);
    if (u.hostname === new URL(upstream).hostname) {
      return prefix + u.pathname + u.search;
    }
    return loc; // 站外跳转（如微信/支付宝）不动
  }
  if (loc.startsWith("//")) return loc;
  if (loc.startsWith("/")) return prefix + loc;
  return loc; // 相对跳转在网关路径层级下语义不变
}

function setCookieHeaders(res) {
  try {
    if (typeof res.headers.getSetCookie === "function") return res.headers.getSetCookie();
  } catch {
    /* ignore */
  }
  const raw = res.headers.get("set-cookie");
  return raw ? [raw] : [];
}

function readReqBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export function createGatewayHandler({ jar, logger, prefix, upstream = baseUrl() }) {
  const P = prefix;
  return async function gatewayHandler(req, res) {
    try {
      let pathQuery = req.url;
      // 剥掉网关前缀
      if (pathQuery === P || pathQuery.startsWith(P + "/")) {
        pathQuery = pathQuery.slice(P.length);
      }
      if (!pathQuery || pathQuery === "/") pathQuery = "/";
      const target = upstream + pathQuery;
      const method = String(req.method || "GET").toUpperCase();
      const hdrs = {
        Host: new URL(upstream).host,
        "User-Agent": userAgent(),
        Accept: req.headers.accept || "*/*",
        "Accept-Language": req.headers["accept-language"] || "zh-CN,zh;q=0.9",
        Referer: upstream + "/",
      };
      const cookie = jar.headerFor(target);
      if (cookie) hdrs.Cookie = cookie;
      let body;
      if (req.headers["content-type"]) {
        hdrs["Content-Type"] = req.headers["content-type"];
      }
      if (req.headers["x-requested-with"]) hdrs["X-Requested-With"] = req.headers["x-requested-with"];
      if (method === "POST" || method === "PUT") {
        body = await readReqBody(req);
      }
      const up = await fetch(target, {
        method,
        headers: hdrs,
        body: body && body.length ? body : undefined,
        redirect: "manual",
        signal: AbortSignal.timeout(requestTimeoutMs() + 10000),
      });
      const sc = setCookieHeaders(up);
      if (sc.length) jar.store(sc, up.url || target);

      const status = up.status;
      const isRedirect = status >= 300 && status < 400;
      const location = up.headers.get("location");
      if (isRedirect && location) {
        const newLoc = rewriteLocation(location, P, upstream);
        res.writeHead(status, {
          Location: newLoc,
          "Cache-Control": "no-store",
        });
        res.end();
        return;
      }
      const contentType = String(up.headers.get("content-type") || "");
      const isHtml = /text\/html|application\/xhtml/i.test(contentType);
      const ctParts = contentType.split(";")[0] || "text/html";
      const head = { "Content-Type": ctParts, "Cache-Control": "no-store" };
      if (isHtml) {
        const buf = Buffer.from(await up.arrayBuffer());
        if (buf.length > MAX_HTML) {
          // 超大 HTML 放弃重写直接转发
          res.writeHead(status, { ...head, "Content-Length": String(buf.length) });
          res.end(buf);
          return;
        }
        const sample = buf.toString("latin1").slice(0, 1500);
        let charset = "";
        const cm = /charset\s*=\s*["']?([a-z0-9_-]+)/i.exec(
          String(up.headers.get("content-type") || "") + sample,
        );
        if (cm) charset = cm[1];
        const isGbk = /gbk|gb2312/i.test(charset);
        const text = isGbk ? new TextDecoder("gbk").decode(buf) : buf.toString("utf8");
        const out = rewriteHtml(text, P);
        // Node 无非 UTF-8 编码器：统一以 UTF-8 回吐并声明（浏览器按声明解码）
        const outBuf = Buffer.from(out, "utf8");
        head["Content-Type"] = `${ctParts}; charset=utf-8`;
        res.writeHead(status, { ...head, "Content-Length": String(outBuf.length) });
        res.end(outBuf);
        return;
      }
      // 静态资源/JS/CSS/图片：流式转发
      res.writeHead(status, head);
      if (method === "HEAD") {
        res.end();
        return;
      }
      for await (const chunk of up.body) {
        res.write(chunk);
      }
      res.end();
    } catch (err) {
      logger?.warn?.(`faxin-gateway error: ${err && err.message ? err.message : err}`);
      if (!res.headersSent) {
        res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
        res.end("网关转发失败：" + ((err && err.message) || err));
      } else {
        res.destroy();
      }
    }
  };
}
