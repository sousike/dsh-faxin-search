// 法信各 .ashx/页面响应的结构化解析（纯文本/正则，无 DOM）。
import { baseUrl } from "./config.mjs";
import { stripTags, unescapeHtml, textify, scanBalanced, extractKeyValueMeta, stripBreadcrumb, withoutScriptStyle } from "./html.mjs";

function stripEntitiesAndCollapse(s) {
  return unescapeHtml(String(s)).replace(/\s+/g, " ").trim();
}

/**
 * 解析 GetFileInfoFor*.ashx 返回的 FirstHtml。
 * 条目结构：<li ...><div class="div-title"><a href='/lib/...gid=X'>标题</a></div>
 * …公布/施行日期文本…</li>；分组头 <li class='allmore'>库名（命中数）…</li>
 */
export function parseFirstHtml(firstHtml, base = baseUrl()) {
  const results = [];
  let group = "";
  const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let liM;
  while ((liM = liRe.exec(firstHtml)) !== null) {
    const liFull = liM[0];
    const li = liM[1];
    if (liFull.slice(0, 160).includes("allmore")) {
      let g = stripEntitiesAndCollapse(stripTags(li));
      g = g.replace(/更多.*$/, "").trim();
      if (g) group = g;
      continue;
    }
    const aM = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i.exec(li);
    if (!aM) continue;
    const href = aM[1];
    const title = unescapeHtml(aM[2].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
    if (!title || title.length < 2) continue;
    // gid 定位：兼容直链 ?gid=A123、详情页 URL 里 url=...%3Fgid%3DA123，
    // 以及结果项内 data-gid="A123" 属性
    let gid = "";
    const gm1 = /(?:gid%3D|gid=)([A-Z0-9]+)/i.exec(href);
    if (gm1) gid = gm1[1];
    if (!gid) {
      const gm2 = /data-gid=["']([A-Z0-9]+)/i.exec(li);
      if (gm2) gid = gm2[1];
    }
    let ctxText = stripEntitiesAndCollapse(stripTags(li));
    ctxText = ctxText.replace(title, "").trim();
    const dates = {};
    let dm = /(\d{4}\.\d{2}\.\d{2})\s*公布/.exec(ctxText);
    if (dm) dates["公布"] = dm[1];
    dm = /(\d{4}\.\d{2}\.\d{2})\s*施行/.exec(ctxText);
    if (dm) dates["施行"] = dm[1];
    results.push({
      title,
      gid,
      url: /^https?:/i.test(href) ? href : base + href,
      group,
      snippet: ctxText.slice(0, 200),
      ...dates,
    });
  }
  // 按 gid 去重
  const seen = new Set();
  return results.filter((r) => {
    if (r.gid && seen.has(r.gid)) return false;
    if (r.gid) seen.add(r.gid);
    return true;
  });
}

/** 解析法条直达 GetZyflTiaoInfo 响应 HTML */
export function parseTiaoHtml(body, base = baseUrl()) {
  const out = { law: "", gid: "", anchorUrl: "", docNoDates: "", tiao: "", content: "" };
  const tm =
    /<a href=["'](\/lib\/Zyfl\/ZyflContent\.aspx\?gid=([A-Z0-9]+)#\d+)["'][^>]*>([^<]+)<\/a><br\s*\/?><span>([^<]*)<\/span>/i.exec(
      body,
    );
  if (tm) {
    out.anchorUrl = base + tm[1];
    out.gid = tm[2];
    out.law = (tm[3] || "").trim();
    out.docNoDates = (tm[4] || "").trim();
  }
  const cm = /<div class="zyfl_tiao_tiaoinfo">([\s\S]*?)<\/div>/i.exec(body);
  if (cm) {
    let seg = cm[1].replace(/<span id="t_\d+"[^>]*><\/span>/g, "");
    seg = seg.replace(/<br\s*\/?>/gi, "\n");
    const text = stripEntitiesAndCollapse(stripTags(seg));
    out.content = text;
    const t2 = /^(第[一二三四五六七八九十百千零]+条(?:之[一二三四五六七八九十]+)?)/.exec(text.trim());
    if (t2) out.tiao = t2[1];
  }
  return out;
}

/**
 * 解析大纲概念检索 GetKeyWordList.ashx 的 keywordhtml。
 * 注意：该 HTML 属性引号用 $ 占位，需先还原为 "。
 */
export function parseOutlineListHtml(keywordHtml) {
  const kh = String(keywordHtml || "").replace(/\$/g, '"');
  const results = [];
  const re =
    /href="(\/keyword\/KeyWordDetail\.aspx\?id=(\d+)[^"]*)"\s+title="([^"]+)"[^>]*>[\s\S]*?<span class="fl num"\s*>([^<]+)<\/span>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(kh)) !== null) {
    const id = m[2];
    const rawTitle = (m[3] || "").trim();
    const num = (m[4] || "").trim();
    const rawText = stripEntitiesAndCollapse(stripTags(m[5]));
    const hasSep = /[>\u300b]/.test(rawTitle) || rawTitle.includes(" > ");
    const codeM = /^([A-Z]\d+(?:\.[A-Z0-9]+)*)/.exec(rawTitle.replace(/\s*>\s*/g, " > "));
    results.push({
      id,
      code: codeM ? codeM[1] : "",
      name: hasSep ? rawText : rawTitle.replace(/^[A-Z]\d+(?:\.[A-Z0-9]+)*/, "").trim() || rawText,
      path: rawTitle.replace(/\s*>\s*/g, " > ").trim(),
      num,
      url: baseUrl() + `/keyword/KeyWordDetail.aspx?id=${id}`,
    });
  }
  const seen = new Set();
  return results.filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
}

/** 提取 <title> 文本并去掉「 - 法信 - …」后缀 */
export function titleFromHtml(html) {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html || "");
  if (!m) return "";
  return stripEntitiesAndCollapse(m[1]).replace(/\s*[-|]\s*法信.*$/, "").trim();
}

function locateTagStart(html, tagName, classPattern) {
  const re = new RegExp(`<${tagName}\\b[^>]*class=["'][^"']*${classPattern}[^"']*["'][^>]*>`, "i");
  const m = re.exec(html);
  if (!m) return null;
  return m.index;
}

function textOfRegion(html, start) {
  if (start === null || start < 0) return "";
  const end = scanBalanced(html, start);
  if (end === -1) return "";
  return textify(html.slice(start, end));
}

const DETAIL_META_KEYS = [
  "制定机关", "文号", "发文字号", "效力等级", "效力级别", "公布日期",
  "施行日期", "时效性", "主题分类", "法律类别", "发布部门",
];

/** 详情页正文提取：优先级 .box.fulltext / .content / #content / .article-content */
export function detailContentFromHtml(html) {
  const doc = withoutScriptStyle(html);
  const candidates = [
    ["div", "fulltext"],
    ["div", "(?:^|\\s)content(?:\\s|$)"],
    ["div", "article-content"],
  ];
  for (const [tag, cls] of candidates) {
    const start = locateTagStart(doc, tag, cls);
    const txt = textOfRegion(doc, start);
    if (txt && txt.length > 20) return txt;
  }
  const idM = /<([a-zA-Z][a-zA-Z0-9]*)\b[^>]*id=["']content["'][^>]*>/.exec(doc);
  if (idM) {
    const txt = textOfRegion(doc, idM.index);
    if (txt && txt.length > 20) return txt;
  }
  // 兜底：body 文本，剔除页脚「法信简介…」
  const bodyRe = /<body[^>]*>/i;
  const bm = bodyRe.exec(doc);
  if (bm) {
    let t = textOfRegion(doc, bm.index);
    if (!t) t = textify(doc);
    const stop = t.indexOf("法信简介");
    if (stop > 100) t = t.slice(0, stop);
    return stripBreadcrumb(t.trim());
  }
  return stripBreadcrumb(textify(doc));
}

/** 详情页 meta（属性弹框 .js-sxTab 内键值行，默认隐藏但服务端直出） */
export function detailMetaFromHtml(html) {
  const doc = withoutScriptStyle(html);
  const re = /<[a-zA-Z][^>]*class=["'][^"']*js-sxTab[^"']*["'][^>]*>/i;
  const m = re.exec(doc);
  if (!m) return {};
  const end = scanBalanced(doc, m.index);
  if (end === -1) return {};
  const text = textify(doc.slice(m.index, end));
  return extractKeyValueMeta(text, DETAIL_META_KEYS);
}

export function parseDetailHtml(html, finalUrl) {
  return {
    title: titleFromHtml(html) || "(无标题)",
    url: finalUrl || "",
    meta: detailMetaFromHtml(html),
    content: detailContentFromHtml(html),
  };
}

/** 大纲详情 KeyWordDetail.aspx 的文本解析（尽力而为）。 */
export function parseOutlineDetailHtml(html) {
  const doc = withoutScriptStyle(html);
  const out = { name: "", code: "", path: "", counts: {}, laws: [] };
  // 1) 概念名+法信码：.right_navation 区域第一个 label/文本
  const navRe = /<[a-zA-Z][^>]*class=["'][^"']*right_navation[^"']*["'][^>]*>/i;
  const navM = navRe.exec(doc);
  if (navM) {
    const end = scanBalanced(doc, navM.index);
    const region = end === -1 ? doc.slice(navM.index, navM.index + 6000) : doc.slice(navM.index, end);
    const labelRe = /<label[^>]*>([\s\S]*?)<\/label>/i.exec(region);
    const labelText = stripEntitiesAndCollapse(
      stripTags(labelRe ? labelRe[1] : region.slice(0, 3000)),
    );
    const cm = /^([A-Z]\d+(?:\.[A-Z0-9]+)*)([\s\S]*)$/.exec(labelText);
    if (cm) {
      out.code = cm[1];
      out.name = cm[2].trim() || titleFromHtml(html);
    }
    const lines = textify(region).split("\n").map((l) => l.trim()).filter(Boolean);
    const pathLine = lines.filter((l) => l.includes(">")).pop();
    if (pathLine) {
      out.path = pathLine.replace(/[·\s]*>[·\s]*/g, " > ").trim();
    }
  }
  if (!out.code) {
    out.name = titleFromHtml(html);
    const mm = /([A-Z]\d+(?:\.[A-Z0-9]+)*)/.exec(out.name);
    if (mm) {
      out.code = mm[1];
      out.name = out.name.replace(mm[1], "").trim();
    }
  }
  // 2) 分库计数：li.navation_item 形如「法 律 99+」
  const liRe = /<li[^>]*class=["'][^"']*navation_item[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi;
  let lm;
  while ((lm = liRe.exec(doc)) !== null) {
    const txt = stripEntitiesAndCollapse(stripTags(lm[1]));
    const cm2 = /^([\s\S]*?)\s*(\d+\+?)$/.exec(txt);
    if (cm2) {
      const key = cm2[1].replace(/\s+/g, "");
      if (key) out.counts[key] = cm2[2];
    }
  }
  // 3) 法条摘录条目（默认「法律」版块 content_item）
  const itemRe = /<[a-zA-Z][^>]*class=["'][^"']*content_item[^"']*["'][^>]*>/gi;
  let im;
  while ((im = itemRe.exec(doc)) !== null) {
    const end = scanBalanced(doc, im.index);
    const region = end === -1 ? doc.slice(im.index, im.index + 1200) : doc.slice(im.index, end);
    const aRe = /<a[^>]+href="([^"]*\/lib\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/i.exec(region);
    const txt = textify(region);
    const lines = txt.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!txt) continue;
    out.laws.push({
      law: aRe ? stripEntitiesAndCollapse(stripTags(aRe[2])) : lines[0] || "",
      url: aRe ? (aRe[1].startsWith("http") ? aRe[1] : baseUrl() + aRe[1]) : "",
      excerpt: lines.slice(aRe ? 1 : 0).join(" ").slice(0, 300),
    });
  }
  return out;
}
