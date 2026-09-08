// MCP 工具定义与调用分发（供 server/mcp-server.mjs 使用；纯函数+api 注入）
import { maxResultsDefault } from "./config.mjs";

const LIB_LABEL = { zyfl: "中央法规", dffl: "地方法规", cpws_al: "裁判规则" };

function countLine(counts) {
  if (!counts || Object.keys(counts).length === 0) return "";
  const parts = Object.entries(counts)
    .filter(([, v]) => Number(v) > 0 || Object.keys(counts).length === 1)
    .map(([k, v]) => `${LIB_LABEL[k] || k} ${v} 条`);
  return parts.length ? "分库命中：" + parts.join("、") + "\n\n" : "";
}

function formatResultList(kind, keyword, data) {
  const results = data.results || [];
  let out = `## 法信${kind}检索：${keyword}\n\n`;
  out += countLine(data.counts);
  if (data.timelinessApplied) out += `时效筛选：${data.timelinessApplied}\n\n`;
  if (data.permissionDenied) {
    out += `🔒 **${data.libName || kind}库访问受限**\n\n${data.message || ""}\n`;
    return out;
  }
  if (results.length === 0) {
    out +=
      "未找到相关结果。建议：①换用案由词或法条原文表述（如「买卖合同」「盗窃公私财物」，避免抽象概念如「违约责任」）；" +
      "②核对关键词错别字；③放宽时效筛选；④裁判规则等付费库需账号有对应权限。\n";
    return out;
  }
  if (data.rawCount > results.length) {
    out += `共抓取 ${data.rawCount} 条，以下为前 ${results.length} 条\n\n`;
  }
  results.forEach((r, i) => {
    out += `### ${i + 1}. ${r.title}\n`;
    out += `gid：${r.gid}（get_detail 用）\n`;
    if (r.lib || r.group) {
      out += `库别：${r.lib || ""}`;
      if (r.group) out += `｜分组：${r.group}`;
      out += "\n";
    }
    const dateInfo = [r["公布"] && `公布：${r["公布"]}`, r["施行"] && `施行：${r["施行"]}`]
      .filter(Boolean)
      .join("｜");
    if (dateInfo) out += `${dateInfo}\n`;
    if (r.snippet) out += `摘要：${r.snippet}\n`;
    out += "\n";
  });
  return out;
}

const LOGIN_HINT =
  "❌ 法信会话未登录或已过期。请在 DSH「法信检索」面板完成一次登录（账号密码 + 若出现的验证码），" +
  "或向 faxin_import_cookies 粘贴浏览器里的 Cookie。完成后再次调用即可。";

export const TOOL_DEFS = [
  {
    name: "faxin_check_login",
    description:
      "检查法信登录态与会话有效期（结果缓存 30 分钟；force=true 强制重检）。返回是否已登录、本地会话 Cookie 数量，以及可用的登录入口。",
    inputSchema: {
      type: "object",
      properties: {
        force: { type: "boolean", description: "强制重新检测（默认 false，使用 30 分钟缓存）" },
      },
    },
  },
  {
    name: "faxin_search_law",
    description:
      "检索法信【法律法规库】（中央+地方），返回结构化结果：标题、gid、库别/分组、公布/施行日期、摘要、分库命中数。" +
      "关键词策略：优先用法条原文表述或法规名（如「盗窃公私财物」「民法典」），抽象法律概念命中率低。" +
      "效力审计：查现行法务必传 timeliness=current，并核对返回的公布/施行日期。" +
      "拿到 gid 后用 faxin_get_detail 读全文；已知法规名+条号直接用 faxin_get_tiao 最快。",
    inputSchema: {
      type: "object",
      properties: {
        keyword: { type: "string", description: "检索关键词（法规名 / 条文原文表述 / 主题词）" },
        timeliness: {
          type: "string",
          enum: ["", "current", "invalid", "modified", "pending"],
          description: "时效筛选：current=现行有效 invalid=失效 modified=已被修改 pending=尚未生效；默认不过滤",
        },
        lib: {
          type: "string",
          enum: ["all", "central", "local"],
          description: "库别：central=中央法规 local=地方法规 all=两者（默认）",
        },
        max_results: { type: "integer", description: "返回条数上限（默认 20，最大 50）" },
      },
      required: ["keyword"],
    },
  },
  {
    name: "faxin_search_case",
    description:
      "检索法信【裁判规则库】（法信编辑提炼的案例要旨/审判意见类内容），返回标题、gid、摘要、分库命中数。" +
      "关键词优先案由词（「买卖合同纠纷」「股权转让纠纷」）。" +
      "注意：该库为付费库，账号无权限时返回 permission 提示；响应较慢，请低频使用。",
    inputSchema: {
      type: "object",
      properties: {
        keyword: { type: "string", description: "检索关键词（案由词优先）" },
        max_results: { type: "integer", description: "返回条数上限（默认 20，最大 30）" },
      },
      required: ["keyword"],
    },
  },
  {
    name: "faxin_search_lib",
    description:
      "检索法信【专题库】：gjty=国家条约（海牙公约等）、xgk=香港法律（条例原文）、amk=澳门法律、" +
      "flqk=法学期刊（论文）、flsy=法律释义（条文理解）、lf=立法资料（草案/征求意见稿）、sf=司法文件（法院典型案例/文件）。" +
      "部分库需账号权限，无权限时返回 permission 提示。",
    inputSchema: {
      type: "object",
      properties: {
        keyword: { type: "string", description: "检索关键词" },
        lib: {
          type: "string",
          enum: ["gjty", "xgk", "amk", "flqk", "flsy", "lf", "sf"],
          description: "专题库代码",
        },
        max_results: { type: "integer", description: "返回条数上限（默认 20，最大 30）" },
      },
      required: ["keyword", "lib"],
    },
  },
  {
    name: "faxin_get_tiao",
    description:
      "【取法条最快通道】法规名+条号直达条文全文，无需先检索。law 支持简称（「民法典」「刑法」「劳动合同法」），" +
      "tiao 支持阿拉伯或中文数字（680 / 第六百八十条 / 第五百七十七条之一）。" +
      "返回法规全称、文号、公布/施行日期、条文号、条文全文、gid+锚点链接。已知法规名和条号时一律用它。",
    inputSchema: {
      type: "object",
      properties: {
        law: { type: "string", description: "法规名（可简称，如「民法典」「刑法」）" },
        tiao: { type: "string", description: "条号，如 \"680\"、\"第六百八十条\"、\"第五百七十七条之一\"" },
      },
      required: ["law", "tiao"],
    },
  },
  {
    name: "faxin_search_outline",
    description:
      "检索【法信大纲】概念（法信码知识树）。输入法律概念/场景词，返回规范概念名、法信码、大纲路径（上下位）、概念 id、各库计数。" +
      "适用：不知道用什么词检索时先做概念发现；或需要概念的上下位体系。" +
      "拿到 id 后用 faxin_get_outline 查看该概念聚合的法条/裁判规则/观点/图书/期刊。",
    inputSchema: {
      type: "object",
      properties: {
        keyword: { type: "string", description: "法律概念或场景词，如「买卖合同」「违约金」" },
        max_results: { type: "integer", description: "返回概念数上限（默认 10）" },
      },
      required: ["keyword"],
    },
  },
  {
    name: "faxin_get_outline",
    description:
      "取【法信大纲】概念详情：概念名、法信码、完整路径、各库聚合数量（法律/裁判规则/观点/图书/期刊）、相关法条摘录（法规名+条号+条文）。" +
      "id 由 faxin_search_outline 返回。工作流：概念发现 → 读概念法条摘录 → 需要深挖的库再 search_law/search_case/search_lib。",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "概念 id（数字，由 faxin_search_outline 返回）" },
      },
      required: ["id"],
    },
  },
  {
    name: "faxin_get_detail",
    description:
      "获取法规/裁判规则/专题库文档详情全文。传入 gid 或完整 URL。gid 前缀路由：A=中央法规 B=地方法规 C=裁判规则 D=法律释义 F=法学期刊 G=立法资料 H=司法文件 J=香港法律 K=澳门法律 M=国家条约。" +
      "法规类可传 tiao 精确取某条（\"577\" / \"第五百七十七条\"）。返回 meta（含时效性/效力等级/公布施行日期）与正文——引用法条前必须核对 meta 时效性。正文过长自动截断。",
    inputSchema: {
      type: "object",
      properties: {
        gid: { type: "string", description: "文档 gid（前缀自动路由）或详情页 URL" },
        tiao: {
          type: "string",
          description: "可选：只取第 X 条，如 \"577\"、\"第五百七十七条\"、\"第五百七十七条之一\"",
        },
      },
      required: ["gid"],
    },
  },
  {
    name: "faxin_import_cookies",
    description:
      "导入法信登录会话 Cookie（手动兜底登录方式）：把浏览器里登录 www.faxin.cn 后复制的 Cookie 头（形如 k=v; k2=v2）粘贴进来，或粘贴 Netscape 格式 cookie 文件内容。成功后 tools 即可带会话检索。",
    inputSchema: {
      type: "object",
      properties: {
        cookie_header: { type: "string", description: "浏览器 Cookie 字符串（k=v; k2=v2...）" },
      },
      required: ["cookie_header"],
    },
  },
];

export const TOOL_NAMES = new Set(TOOL_DEFS.map((t) => t.name));

export async function dispatchTool(api, name, args) {
  try {
    switch (name) {
      case "faxin_check_login": {
        const r = await api.checkLogin({ force: !!args?.force });
        const lines = [
          r.ok ? "✅ 法信会话可用" : "❌ 法信会话不可用",
          `诊断：${r.diag || ""}`,
          `本地会话 Cookie：${r.liveCount ?? 0} 条`,
        ];
        if (!r.ok) {
          lines.push("");
          lines.push(LOGIN_HINT);
        }
        return lines.join("\n");
      }
      case "faxin_search_law": {
        const keyword = String(args?.keyword || "").trim();
        if (!keyword) return "⚠️ 请提供 keyword 参数。";
        const data = await api.searchLaw({
          keyword,
          timeliness: args?.timeliness || "",
          lib: args?.lib || "all",
          maxResults: args?.max_results,
        });
        return formatResultList("法规", keyword, data);
      }
      case "faxin_search_case": {
        const keyword = String(args?.keyword || "").trim();
        if (!keyword) return "⚠️ 请提供 keyword 参数。";
        const data = await api.searchCases({ keyword, maxResults: args?.max_results });
        return formatResultList("裁判规则", keyword, data);
      }
      case "faxin_search_lib": {
        const keyword = String(args?.keyword || "").trim();
        const lib = String(args?.lib || "").trim();
        const libs = ["gjty", "xgk", "amk", "flqk", "flsy", "lf", "sf"];
        if (!keyword || !libs.includes(lib)) {
          return `⚠️ 请提供 keyword 和合法的 lib（${libs.join("/")}）。`;
        }
        const data = await api.searchLib({ keyword, lib, maxResults: args?.max_results });
        return formatResultList(data.libName, keyword, data);
      }
      case "faxin_get_tiao": {
        const law = String(args?.law || "").trim();
        const tiao = String(args?.tiao || "").trim();
        if (!law || !tiao) return "⚠️ 请提供 law（法规名）和 tiao（条号）参数。";
        const d = await api.getTiao(law, tiao);
        let out = `## ${d.law} ${d.tiao}\n\n`;
        if (d.docNoDates) out += `${d.docNoDates}\n\n`;
        out += `${d.content}\n\n`;
        if (d.anchorUrl) out += `来源：${d.anchorUrl}\n`;
        out += "_引用前如需核验时效性，可用 gid 调 faxin_get_detail 查看完整 meta。_\n";
        return out;
      }
      case "faxin_search_outline": {
        const keyword = String(args?.keyword || "").trim();
        if (!keyword) return "⚠️ 请提供 keyword 参数。";
        const concepts = await api.searchOutline(keyword, Number(args?.max_results) || 10);
        if (concepts.length === 0) {
          return (
            `大纲中未找到「${keyword}」相关概念。建议换更上位的概念词` +
            "（如「合同」而非「二手设备买卖」），或直接用 search_law / search_case 检索。"
          );
        }
        let out = `## 法信大纲概念：${keyword}\n\n共 ${concepts.length} 个相关概念\n\n`;
        concepts.forEach((c, i) => {
          out += `### ${i + 1}. ${c.name}（法信码 ${c.code || "?"}）\n`;
          if (c.path) out += `路径：${c.path}\n`;
          out += `概念 id：${c.id}（get_outline 用）｜命中：${c.num || "?"}\n\n`;
        });
        return out;
      }
      case "faxin_get_outline": {
        const id = String(args?.id || "").trim();
        if (!id) return "⚠️ 请提供 id 参数（由 faxin_search_outline 返回）。";
        const d = await api.getOutline(id);
        let out = `## ${d.name || "(未识别概念名)"}（法信码 ${d.code || "?"}）\n\n`;
        if (d.path) out += `大纲路径：${d.path}\n\n`;
        if (d.counts && Object.keys(d.counts).length) {
          out +=
            "聚合资源：" +
            Object.entries(d.counts)
              .map(([k, v]) => `${k} ${v}`)
              .join("、") +
            "\n\n";
        }
        if (d.laws && d.laws.length) {
          out += `### 相关法条（前 ${d.laws.length} 条摘录）\n\n`;
          d.laws.forEach((law, i) => {
            out += `${i + 1}. **${law.law}**\n   ${law.excerpt}\n\n`;
          });
        }
        out += "_提示：需深挖某类资源时，用概念名作为关键词调 search_law / search_case / search_lib。_\n";
        return out;
      }
      case "faxin_get_detail": {
        const gid = String(args?.gid || "").trim();
        if (!gid) return "⚠️ 请提供 gid 参数。";
        const d = await api.getDetail(gid, String(args?.tiao || ""));
        let out = `## ${d.title}\n\n链接：${d.url}\n\n`;
        if (d.meta && Object.keys(d.meta).length) {
          out += "### 基本信息（引用前请核对时效性）\n";
          for (const [k, v] of Object.entries(d.meta)) out += `- ${k}：${v}\n`;
          out += "\n";
        }
        if (d.tiaoNote) out += `_${d.tiaoNote}_\n\n`;
        out += `### 正文\n\n${d.content}\n`;
        if (d.truncated) {
          out += "\n_（正文过长已截断；法规类建议用 tiao 参数按条取）_\n";
        }
        return out;
      }
      case "faxin_import_cookies": {
        const header = String(args?.cookie_header || "");
        if (!header.trim()) return "⚠️ 请粘贴 Cookie 头内容。";
        const r = api.importCookies(header);
        return r.ok
          ? `✅ 已导入 ${r.count} 条 Cookie。可先调用 faxin_check_login 验证会话。`
          : `❌ ${r.error || "导入失败"}`;
      }
      default:
        return `未知工具：${name}`;
    }
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    if (err && err.name === "SessionExpired") {
      return `${LOGIN_HINT}\n（诊断：${msg}）`;
    }
    return `执行失败：${msg}`;
  }
}
