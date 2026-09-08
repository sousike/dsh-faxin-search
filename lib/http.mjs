// 带会话 cookie 的 HTTP 客户端（纯 Node fetch，手动跟随重定向以便
// 捕获每一跳 Set-Cookie 与登录页跳转检测）。
import { baseUrl, requestTimeoutMs, userAgent } from "./config.mjs";

export class SessionExpired extends Error {
  constructor(message) {
    super(message);
    this.name = "SessionExpired";
  }
}

export class FaxinHttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "FaxinHttpError";
    this.status = status;
  }
}

const MAX_REDIRECTS = 8;

function looksLikeLoginPage(url, bodyHead) {
  if (/login/i.test(url)) return true;
  const head = String(bodyHead || "").slice(0, 3000);
  return (
    head.includes("请输入账号") ||
    head.includes("请先登录") ||
    (head.includes("登录法信") && !head.includes("退出"))
  );
}

function setCookieHeaders(res) {
  try {
    if (typeof res.headers.getSetCookie === "function") return res.headers.getSetCookie();
  } catch {
    /* ignore */
  }
  const raw = res.headers.get("set-cookie");
  if (!raw) return [];
  // 老实现把多条合并为一条逗号串，这里保守处理：仅当不含逗号分割歧义时切分
  return raw.split(/,(?=\s*[a-zA-Z0-9_.-]+=)/);
}

async function oneFetch(jar, method, targetUrl, { form, json, headers = {}, signal } = {}) {
  const base = baseUrl();
  const abs = /^https?:\/\//i.test(targetUrl) ? targetUrl : base + targetUrl;
  const cookie = jar.headerFor(abs);
  const hdrs = {
    "User-Agent": userAgent(),
    Accept: "*/*",
    ...(cookie ? { Cookie: cookie } : {}),
    ...headers,
  };
  let body;
  if (form) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(form)) {
      if (v === undefined || v === null) continue;
      params.append(k, String(v));
    }
    body = params.toString();
    hdrs["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8";
  } else if (json !== undefined) {
    body = JSON.stringify(json);
    hdrs["Content-Type"] = "application/json; charset=utf-8";
  }
  const res = await fetch(abs, {
    method,
    headers: hdrs,
    body,
    redirect: "manual",
    signal: signal || AbortSignal.timeout(requestTimeoutMs()),
  });
  // 吸收本跳 Set-Cookie
  const sc = setCookieHeaders(res);
  if (sc.length > 0) jar.store(sc, res.url || abs);
  return res;
}

/**
 * 带会话请求：手动跟随重定向（每跳保存 cookie），返回最终响应。
 * 若最终落到登录页，抛 SessionExpired。
 */
export async function sessionFetch(jar, method, targetUrl, options = {}) {
  let url = targetUrl;
  let m = method;
  let opts = { ...options };
  let hops = 0;
  let res;
  for (;;) {
    try {
      res = await oneFetch(jar, m, url, { ...opts, form: opts.form, json: opts.json });
    } catch (err) {
      if (hops === 0) {
        // 网络/超时重试一次
        res = await oneFetch(jar, m, url, { ...opts, form: opts.form, json: opts.json });
      } else {
        throw err;
      }
    }
    hops += 1;
    const status = res.status;
    const isRedirect = status >= 300 && status < 400 && res.headers.get("location");
    if (!isRedirect || hops > MAX_REDIRECTS) {
      // 记录是否被重定向到登录页
      const finalUrl = res.url || url;
      if (looksLikeLoginPage(finalUrl, "")) {
        res.finalUrl = finalUrl;
      }
      return res;
    }
    const location = res.headers.get("location");
    url = new URL(location, res.url || baseUrl()).toString();
    if (status === 303 || (m === "POST" && status !== 307 && status !== 308)) {
      m = "GET";
      opts = { headers: opts.headers };
    }
    // 丢弃已消费的 body（fetch manual 下未读 body 会挂起连接，需 cancel）
    try {
      await res.body?.cancel();
    } catch {
      /* ignore */
    }
  }
}

/** 表单 POST，返回 {status, headers, finalUrl, text, ok} */
export async function formPost(jar, path, form, extraHeaders = {}) {
  const res = await sessionFetch(jar, "POST", path, {
    form,
    headers: { "X-Requested-With": "XMLHttpRequest", Referer: baseUrl() + "/", ...extraHeaders },
  });
  const buf = Buffer.from(await res.arrayBuffer());
  const text = buf.toString("utf8");
  const finalUrl = res.finalUrl || res.url || "";
  if (looksLikeLoginPage(finalUrl, text)) {
    throw new SessionExpired(`请求被重定向到登录页: ${path}`);
  }
  return { status: res.status, headers: res.headers, finalUrl, text, buf };
}

/** 带会话 GET；对 HTML 页面做登录页检测。返回 {status, headers, finalUrl, text, buf} */
export async function sessionGet(jar, pathOrUrl) {
  const res = await sessionFetch(jar, "GET", pathOrUrl);
  const contentType = String(res.headers.get("content-type") || "");
  const buf = Buffer.from(await res.arrayBuffer());
  const finalUrl = res.finalUrl || res.url || "";
  if (looksLikeLoginPage(finalUrl, buf.toString("utf8").slice(0, 3000))) {
    throw new SessionExpired(`GET ${pathOrUrl} 被重定向至登录页`);
  }
  return { status: res.status, headers: res.headers, finalUrl, text: buf.toString("utf8"), buf, contentType };
}

export { looksLikeLoginPage };
