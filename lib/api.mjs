// 法信数据访问层：把 parse/http/cn-num 组合成结构化检索 API。
import { baseUrl, maxResultsDefault } from "./config.mjs";
import { CookieJar } from "./cookie-jar.mjs";
import { formPost, sessionGet, SessionExpired } from "./http.mjs";
import { cnToInt, intToCn, normalizeTiaoToCn, extractTiao } from "./cn-num.mjs";
import {
  parseFirstHtml,
  parseTiaoHtml,
  parseOutlineListHtml,
  parseDetailHtml,
  parseOutlineDetailHtml,
} from "./parse.mjs";
import { decodeBuffer, stripBreadcrumb } from "./html.mjs";

export const TIMELINESS = {
  current: { code: "01", label: "现行有效" },
  invalid: { code: "02", label: "失效" },
  modified: { code: "03", label: "已被修改" },
  pending: { code: "04", label: "尚未生效" },
};
const TIMELINESS_BY_CODE = Object.fromEntries(Object.values(TIMELINESS).map((t) => [t.code, t.label]));

const GID_ROUTES = {
  A: "/lib/zyfl/zyflcontent.aspx?gid=", // 中央法规
  B: "/lib/dffl/DfflContent.aspx?gid=", // 地方法规
  C: "/lib/cpal/AlyzContent.aspx?isAlyz=1&gid=", // 裁判规则
  D: "/lib/syyl/SyylContent.aspx?gid=", // 法律释义
  F: "/lib/flwx/FlqkContent.aspx?gid=", // 法学期刊
  G: "/lib/lfsf/LfContent.aspx?gid=", // 立法资料
  H: "/lib/lfsf/sfContent.aspx?gid=", // 司法文件
  J: "/lib/xgk/HKflContent.aspx?gid=", // 香港法律
  K: "/lib/amk/MacflContent.aspx?gid=", // 澳门法律
  M: "/lib/gjty/GjtyContent.aspx?gid=", // 国家条约
};

const EXTRA_LIBS = {
  lf: { name: "立法资料", handler: "GetFileInfoForlf.ashx", ust: "1" },
  sf: { name: "司法文件", handler: "GetFileInfoForsf.ashx", ust: "1" },
  gjty: { name: "国家条约", handler: "GetFileInfoForgjty.ashx", ust: "1" },
  flqk: { name: "法学期刊", handler: "GetFileInfoForflqk.ashx", ust: "1" },
  flsy: { name: "法律释义", handler: "GetFileInfoForflsy.ashx", ust: "1" },
  amk: { name: "澳门法律", handler: "GetFileInfoForamk.ashx", ust: "1" },
  xgk: { name: "香港法律", handler: "GetFileInfoForxgk.ashx", ust: "4" },
};

function isNoContent(body) {
  return String(body).includes("no_content") || String(body).includes("暂时没有找到您想要的内容");
}

function numOr0(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export class FaxinApi {
  constructor({ jar } = {}) {
    this.jar = jar || new CookieJar();
    this.base = baseUrl();
    this._loginOkAt = 0;
    this._loginCacheTtl = 30 * 60 * 1000;
  }

  // —— 基础 ——
  get jarInfo() {
    return { hasCookies: this.jar.liveCount() > 0, liveCount: this.jar.liveCount() };
  }

  async libCounts(keyword, libs) {
    const counts = {};
    await Promise.all(
      libs.map(async (lib) => {
        try {
          const r = await formPost(this.jar, "/alllibsearch/GetLibSearchResultNum.ashx", {
            k: keyword,
            IsInResult: "0",
            keyword_inResult: keyword,
            usersearchtype: "1",
            lib,
          });
          const data = JSON.parse(r.text);
          counts[lib] = numOr0(data && data.searchnum);
        } catch {
          counts[lib] = 0;
        }
      }),
    );
    return counts;
  }

  /**
   * 登录态检测：
   * - 无会话 cookie → 未登录；
   * - 访问需登录的检索页被重定向到登录页 → 会话过期；
   * - 结果缓存 30 分钟。
   * 注意：法信部分库（法规检索/大纲）匿名可用；裁判规则/观点/类案等需账号付费权限，
   * 是否可读在具体检索结果里再判断。
   */
  async checkLogin({ force = false } = {}) {
    const now = Date.now();
    if (!force && now - this._loginOkAt < this._loginCacheTtl) {
      return { ok: true, diag: "登录态缓存有效（30 分钟内已验证）", ...this.jarInfo };
    }
    if (this.jar.liveCount() === 0) {
      return { ok: false, diag: "本地没有任何法信会话 Cookie —— 请先在「法信检索」面板完成一次登录", hasCookies: false, liveCount: 0 };
    }
    try {
      await sessionGet(
        this.jar,
        `${this.base}/alllibsearch/SearchResult.aspx?usersearchtype=1&keyword=test`,
      );
      this._loginOkAt = now;
      return { ok: true, diag: "会话有效（检索页可访问）", ...this.jarInfo };
    } catch (err) {
      if (err instanceof SessionExpired) {
        return {
          ok: false,
          diag: "会话已过期或失效 —— 请重新登录（面板一键登录或粘贴 Cookie）",
          ...this.jarInfo,
        };
      }
      return { ok: false, diag: `检测异常: ${err && err.message ? err.message : err}`, ...this.jarInfo };
    }
  }

  // —— 法规检索 ——
  async searchLaw({ keyword, timeliness = "", lib = "all", maxResults } = {}) {
    const max = Math.min(maxResults || maxResultsDefault(), 50);
    const shixiao =
      (TIMELINESS[timeliness] && TIMELINESS[timeliness].code) ||
      (TIMELINESS_BY_CODE[timeliness] ? timeliness : "");
    const libs =
      lib === "central" ? ["zyfl"] : lib === "local" ? ["dffl"] : ["zyfl", "dffl"];

    const fetchOne = async (lb, smlib = "other", groupLabel = "") => {
      const handler = lb === "zyfl" ? "GetFileInfoForZyfl.ashx" : "GetFileInfoForDffl.ashx";
      const r = await formPost(this.jar, `/alllibsearch/${handler}`, {
        keyTitle: keyword,
        lib: lb,
        smlib,
        firstPage: "1",
        listnum: String(Math.min(max, 50)),
        usersearchtype: "1",
        libsearchtype: "1",
        sort_field: "",
        sort_id_left: "0",
        xiaoli_id_left: "0",
        shixiao_id_left: shixiao || "0",
        fdep_id_left: "0",
      });
      const data = JSON.parse(r.text);
      const items = parseFirstHtml(data.FirstHtml || "", this.base);
      for (const it of items) {
        it.lib = lb === "zyfl" ? "中央法规" : "地方法规";
        if (groupLabel) it.group = groupLabel;
      }
      return items;
    };

    const jobs = [];
    for (const lb of libs) {
      if (lb === "zyfl") {
        jobs.push(fetchOne("zyfl", "lfjs", "法律（含法典本体）"));
        jobs.push(fetchOne("zyfl", "other"));
      } else {
        jobs.push(fetchOne(lb));
      }
    }
    const [lists, counts] = await Promise.all([Promise.all(jobs), this.libCounts(keyword, libs)]);
    const results = lists.flat();
    const seen = new Set();
    const deduped = [];
    for (const r of results) {
      if (r.gid && seen.has(r.gid)) continue;
      if (r.gid) seen.add(r.gid);
      deduped.push(r);
    }
    return {
      results: deduped.slice(0, max),
      rawCount: deduped.length,
      counts,
      timelinessApplied: TIMELINESS_BY_CODE[shixiao] || "",
    };
  }

  // —— 裁判规则（审判/案例要旨） ——
  async searchCases({ keyword, maxResults } = {}) {
    const max = Math.min(maxResults || maxResultsDefault(), 30);
    const r = await formPost(this.jar, "/alllibsearch/GetFileInfoForAlyz.ashx", {
      keyTitle: keyword,
      isAlyz: "1",
      lib: "",
      firstPage: "1",
      listnum: String(Math.min(max, 30)),
      usersearchtype: "1",
      libsearchtype: "1",
      sort_field: "",
      sort_id_left: "0",
      fcourt_id_left: "",
      xfys_id_left: "",
      cpsxz_id_left: "",
      slcx_id_left: "",
      result_id_left: "0",
      comefrom_id_left: "",
    });
    const data = JSON.parse(r.text);
    const results = parseFirstHtml(data.FirstHtml || "", this.base);
    for (const it of results) it.lib = "裁判规则";
    const counts = await this.libCounts(keyword, ["cpws_al"]);
    if (results.length === 0) {
      const allCount = numOr0(data.AllCount);
      if (isNoContent(r.text) && allCount > 0) {
        return {
          results: [],
          rawCount: 0,
          counts,
          permissionDenied: true,
          libName: "裁判规则",
          message:
            "该关键词在「裁判规则库」有命中计数（AllCount=" + allCount +
            "）但结果列表为空：通常是 ①关键词过抽象（请改用案由词/条文原文表述，如把「违约金过高」换成「房屋买卖合同纠纷」），" +
            "或 ②你的账号对该库无内容访问权限（付费库，可在法信官网为该账号开通后重试）。",
        };
      }
    }
    return { results: results.slice(0, max), rawCount: results.length, counts };
  }

  // —— 专题库 ——
  async searchLib({ keyword, lib, maxResults } = {}) {
    const cfg = EXTRA_LIBS[lib];
    if (!cfg) throw new Error(`未知专题库: ${lib}（可用: ${Object.keys(EXTRA_LIBS).join("/")}）`);
    const max = Math.min(maxResults || maxResultsDefault(), 30);
    const form = {
      keyTitle: keyword,
      lib,
      firstPage: "1",
      listnum: String(max),
      usersearchtype: cfg.ust,
      libsearchtype: cfg.ust,
      sort_field: "",
      fdep_id_left: "",
    };
    if (lib === "xgk") form.notitle = "1";
    const r = await formPost(this.jar, `/alllibsearch/${cfg.handler}`, form);
    const data = JSON.parse(r.text);
    const results = parseFirstHtml(data.FirstHtml || "", this.base);
    for (const it of results) it.lib = cfg.name;
    if (results.length === 0) {
      const allCount = numOr0(data.AllCount);
      if (isNoContent(r.text) && allCount > 0) {
        return {
          results: [],
          rawCount: 0,
          counts: {},
          permissionDenied: true,
          libName: cfg.name,
          message:
            "该关键词在「" + cfg.name + "」库有命中计数（AllCount=" + allCount +
            "）但结果列表为空：通常是 ①关键词过抽象（请改用原文表述/案由词），" +
            "或 ②你的账号对该库无内容访问权限（付费库，可开通后重试）。",
        };
      }
    }
    return { results: results.slice(0, max), rawCount: results.length, counts: {}, libName: cfg.name };
  }

  // —— 法条直达 ——
  async getTiao(lawRaw, tiaoRaw) {
    const law = String(lawRaw).trim().replace(/^《|》$/g, "");
    if (!law) throw new Error("缺少法规名 law");
    const cnTiao = normalizeTiaoToCn(tiaoRaw);
    if (!cnTiao) {
      throw new Error(`条号格式无法识别: ${tiaoRaw}（示例：577 / 第五百七十七条 / 第五百七十七条之一）`);
    }
    const r = await formPost(this.jar, "/alllibsearch/GetZyflTiaoInfo.ashx", {
      k: `${law}${cnTiao}`,
      t: "1",
    });
    if (!r.text.trim()) {
      throw new Error(`未命中：${law}${cnTiao}。请核对法规名与条号`);
    }
    const parsed = parseTiaoHtml(r.text, this.base);
    if (!parsed.content) {
      throw new Error(`命中法规但条文解析失败：${law}${cnTiao}（响应结构可能已变化）`);
    }
    return {
      ...parsed,
      law: parsed.law || law,
      tiao: parsed.tiao || cnTiao,
      tiaoCn: cnTiao,
      content: parsed.content,
    };
  }

  // —— 大纲概念 ——
  async searchOutline(keyword, maxResults = 10) {
    const r = await formPost(this.jar, "/alllibsearch/GetKeyWordList.ashx", {
      keyword,
      IsInResult: "0",
      keyword_inResult: keyword,
      usersearchtype: "1",
      libsearchtype: "",
    });
    const data = JSON.parse(r.text);
    return parseOutlineListHtml(data.keywordhtml || "");
  }

  async getOutline(idRaw) {
    const cid = String(idRaw).replace(/\D/g, "");
    if (!cid) throw new Error("概念 id 必须是数字（由 searchOutline 返回）");
    const r = await sessionGet(this.jar, `${this.base}/keyword/KeyWordDetail.aspx?id=${cid}`);
    const body = decodeBuffer(r.buf, r.contentType);
    const parsed = parseOutlineDetailHtml(body);
    parsed.id = cid;
    parsed.url = `${this.base}/keyword/KeyWordDetail.aspx?id=${cid}`;
    return parsed;
  }

  // —— 详情 ——
  gidToDetailPath(gidOrUrl) {
    const s = String(gidOrUrl).trim();
    if (/^https?:/i.test(s)) return s;
    if (s.startsWith("/")) return this.base + s;
    const prefix = s[0] ? s[0].toUpperCase() : "";
    const route = GID_ROUTES[prefix];
    if (route) return this.base + route + s;
    return `${this.base}/lib/zyfl/zyflcontent.aspx?gid=${s}`;
  }

  async getDetail(gidOrUrl, tiaoRaw = "") {
    const url = this.gidToDetailPath(gidOrUrl);
    const r = await sessionGet(this.jar, url);
    const body = decodeBuffer(r.buf, r.contentType);
    if (body.slice(0, 2000).includes("页面不存在")) {
      throw new Error(`详情页不存在或 gid 路由错误：${url}`);
    }
    const parsed = parseDetailHtml(body, r.finalUrl || url);
    let content = stripBreadcrumb(parsed.content);
    let truncated = false;
    let tiaoNote = "";
    if (tiaoRaw) {
      const seg = extractTiao(content, tiaoRaw);
      if (seg) {
        content = seg;
        const t = String(tiaoRaw).trim().replace(/^第/, "").replace(/条$/, "");
        tiaoNote = `已定位「第${t}条」`;
      } else {
        tiaoNote = `⚠️ 未能在正文中定位「第${String(tiaoRaw).trim()}条」，返回全文开头（请人工核对条号写法）`;
        content = content.slice(0, 8000);
        truncated = parsed.content.length > 8000;
      }
    } else if (content.length > 20000) {
      content = content.slice(0, 20000);
      truncated = true;
    }
    return { title: parsed.title, url: parsed.url, meta: parsed.meta, content, truncated, tiaoNote };
  }

  // —— Cookie 管理（供工具/面板） ——
  importCookies(text) {
    return this.jar.importHeader(text);
  }

  clearCookies() {
    this.jar.clear();
  }
}

export { EXTRA_LIBS };
