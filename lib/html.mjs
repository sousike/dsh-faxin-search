// 无 DOM 的 HTML 处理：字符集解码、文本化、区域提取。
// 全部为正则/扫描实现，零依赖（MCP 子进程与主进程共用）。
const NAMED = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—",
  ldquo: "\u201c", rdquo: "\u201d", lsquo: "\u2018", rsquo: "\u2019",
  middot: "·", hellip: "…", laquo: "«", raquo: "»",
};

export function unescapeHtml(s) {
  return String(s).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X"
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      if (!Number.isNaN(code)) {
        try {
          return String.fromCodePoint(code);
        } catch {
          return m;
        }
      }
      return m;
    }
    return Object.prototype.hasOwnProperty.call(NAMED, body) ? NAMED[body] : m;
  });
}

export function stripTags(s) {
  return unescapeHtml(String(s).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

const BLOCK_END = /<\/(p|div|li|tr|h[1-6]|section|article|table|ul|ol|dl|dd|dt|blockquote|pre|title)>/gi;
const BR = /<br\s*\/?>/gi;

/** 去掉 script/style/注释后再做标签扫描，避免其中文本干扰配对计数。 */
export function withoutScriptStyle(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
}

/** HTML → 纯文本（保留段落/换行），剔除 script/style/注释。 */
export function textify(html) {
  let s = withoutScriptStyle(html);
  s = s.replace(BR, "\n");
  s = s.replace(BLOCK_END, "\n");
  s = unescapeHtml(s.replace(/<[^>]+>/g, "")); // 去标签但保留换行结构
  s = s.replace(/[ \t]+/g, " ");
  s = s.replace(/\n[ \t]+/g, "\n");
  s = s.replace(/[ \t]+\n/g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

/**
 * 从 html 的 startIdx 处开始（应指向一个开始标签 '<'），扫描同名标签
 * 的嵌套并返回匹配结束标签之后的索引；找不到返回 -1。
 */
export function scanBalanced(html, startIdx) {
  const head = html.slice(startIdx);
  const openM = /^<\s*([a-zA-Z][a-zA-Z0-9]*)/.exec(head);
  if (!openM) return -1;
  const tag = openM[1].toLowerCase();
  const nameRe = new RegExp(`<(/?)\\s*${tag}\\b`, "gi");
  let depth = 0;
  let m;
  nameRe.lastIndex = startIdx;
  while ((m = nameRe.exec(html)) !== null) {
    const isClose = m[1] === "/";
    const gt = html.indexOf(">", m.index);
    const segEnd = gt === -1 ? html.length : gt + 1;
    const seg = html.slice(m.index, segEnd);
    if (isClose) {
      depth -= 1;
      if (depth === 0) return segEnd;
    } else {
      if (!/\/\s*>$/.test(seg)) depth += 1; // 自闭合标签不计数
    }
    nameRe.lastIndex = segEnd;
  }
  return -1;
}

/** 返回 (start,end) 含开始标签与结束标签的区间；找不到返回 null。 */
export function locateTag(html, pattern) {
  const m = pattern.exec(html);
  if (!m) return null;
  const end = scanBalanced(html, m.index);
  if (end === -1) return null;
  return { start: m.index, end };
}

/**
 * 按响应头 content-type 与 HTML 元信息探测字符集并解码 Buffer。
 * 老 ASP 页面常为 GBK 系，错误按 UTF-8 解码会出现乱码。
 */
export function decodeBuffer(buf, contentType = "", headSample = "") {
  let charset = "";
  const ct = String(contentType || "").toLowerCase();
  const cm = /charset\s*=\s*["']?([a-z0-9_-]+)/i.exec(ct);
  if (cm) charset = cm[1];
  if (!charset) {
    const meta = /<meta[^>]+charset\s*=\s*["']?([a-z0-9_-]+)/i.exec(headSample || buf.toString("latin1").slice(0, 2000));
    if (meta) charset = meta[1];
  }
  const norm = charset.toLowerCase().replace(/[_-]/g, "").replace("gb2312", "gbk");
  try {
    if (norm && norm !== "utf8" && norm !== "utf") {
      // Node 全量 ICU 支持 gbk/gb18030/big5
      return new TextDecoder(norm === "gbk" ? "gbk" : norm).decode(buf);
    }
    return buf.toString("utf8");
  } catch {
    return buf.toString("utf8");
  }
}

/** 简单切分 js-sxTab 等「键 值」相邻行 */
export function extractKeyValueMeta(text, keys) {
  const out = {};
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  for (let i = 0; i < lines.length - 1; i++) {
    const k = lines[i];
    if (!keys.includes(k) || out[k]) continue;
    const v = lines[i + 1];
    if (v && !keys.includes(v)) out[k] = v;
  }
  return out;
}

/** 文本前置去除「首页 > xxx > … > 正文」面包屑导航 */
export function stripBreadcrumb(content) {
  if (!String(content).startsWith("首页")) return content;
  const lines = String(content).split("\n");
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    if (lines[i].trim() === "正文") {
      return lines.slice(i + 1).join("\n").trim();
    }
  }
  return content;
}
