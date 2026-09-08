// dsh-faxin-search 面板（浏览器端）。由插件 tapIndex 注入 <script src="/faxin/panel.js">。
// 功能：法信会话登录引导（嵌入网关 iframe + Cookie 导入兜底）、会话状态、
// 快速结构化检索演示。不依赖任何框架。
(function () {
  if (window.__faxinPanelLoaded) return;
  window.__faxinPanelLoaded = true;

  var API = "/faxin/api";
  var GW = "/faxin-gw";
  var LS = "faxin-panel-open";

  var css = [
    ".fxp-root{position:fixed;left:12px;bottom:12px;z-index:2147483000;font-family:inherit;color:#1f2733}",
    ".fxp-btn{width:46px;height:46px;border-radius:50%;border:1px solid rgba(0,0,0,.12);cursor:pointer;background:linear-gradient(135deg,#1a3a6b,#2f6fbf);color:#fff;font-size:20px;font-weight:700;box-shadow:0 4px 14px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;transition:transform .15s ease}",
    ".fxp-btn:hover{transform:scale(1.06)}",
    ".fxp-modal{position:fixed;inset:0;z-index:2147483100;background:rgba(10,18,32,.45);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(2px)}",
    ".fxp-card{width:min(960px,94vw);height:min(720px,92vh);background:#fff;border-radius:14px;box-shadow:0 18px 60px rgba(0,0,0,.35);display:flex;flex-direction:column;overflow:hidden;color-scheme:light}",
    ".fxp-head{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid #e6ebf2;background:#f7f9fc}",
    ".fxp-head b{font-size:15px}",
    ".fxp-close{margin-left:auto;border:none;background:#eef1f6;border-radius:8px;padding:6px 12px;cursor:pointer;font-size:13px}",
    ".fxp-tabs{display:flex;gap:4px;padding:8px 16px 0;border-bottom:1px solid #e6ebf2;background:#f7f9fc}",
    ".fxp-tab{border:1px solid transparent;border-bottom:none;background:transparent;padding:8px 16px;border-radius:8px 8px 0 0;cursor:pointer;font-size:13px;color:#5a6b85}",
    ".fxp-tab.on{background:#fff;border-color:#e6ebf2;color:#1a3a6b;font-weight:600}",
    ".fxp-body{flex:1;overflow:auto;padding:14px 16px}",
    ".fxp-status{display:inline-flex;align-items:center;gap:8px;font-size:12px;padding:4px 10px;border-radius:20px;background:#eef1f6;color:#4a5a72}",
    ".fxp-dot{width:8px;height:8px;border-radius:50%;background:#c0c8d4;display:inline-block}",
    ".fxp-dot.ok{background:#1fbf6f}.fxp-dot.bad{background:#e4572e}",
    ".fxp-frame{width:100%;height:480px;border:1px solid #d9e0ea;border-radius:10px;background:#fff}",
    ".fxp-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:8px 0}",
    ".fxp-input{border:1px solid #ccd5e2;border-radius:8px;padding:7px 10px;font-size:13px;min-width:160px;flex:1}",
    ".fxp-sel{border:1px solid #ccd5e2;border-radius:8px;padding:7px;font-size:13px;background:#fff}",
    ".fxp-btn2{border:none;border-radius:8px;padding:8px 14px;font-size:13px;cursor:pointer;background:#2f6fbf;color:#fff}",
    ".fxp-btn2.ghost{background:#eef1f6;color:#2c3e50}",
    ".fxp-btn2.warn{background:#fdeaea;color:#b03a2e}",
    ".fxp-ta{width:100%;box-sizing:border-box;height:110px;border:1px solid #ccd5e2;border-radius:8px;padding:8px;font-size:12px;font-family:ui-monospace,Consolas,monospace}",
    ".fxp-pre{white-space:pre-wrap;word-break:break-word;background:#0f1a2b;color:#d8e4f5;border-radius:10px;padding:12px;font-size:12.5px;line-height:1.55;max-height:430px;overflow:auto;margin:10px 0 0}",
    ".fxp-pre.ok{background:#f2f7f2;color:#1f3d2b;border:1px solid #cfe3cf}",
    ".fxp-item{border:1px solid #e2e8f0;border-left:3px solid #2f6fbf;border-radius:8px;padding:8px 10px;margin:8px 0;font-size:13px}",
    ".fxp-item .t{font-weight:600;color:#173a6b}",
    ".fxp-muted{font-size:12px;color:#7b8aa0}",
    ".fxp-note{font-size:12px;color:#7b8aa0;margin:6px 0;line-height:1.5}",
    ".fxp-hide{display:none}",
  ].join("\n");

  var style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  async function getJSON(url, opts) {
    var res = await fetch(url, opts);
    var data = await res.json().catch(function () { return {}; });
    return data;
  }

  // —— 弹层骨架 ——
  var modal = el("div", "fxp-modal fxp-hide");
  var card = el("div", "fxp-card");

  var head = el("div", "fxp-head");
  head.appendChild(el("b", null, "法信检索 · DSH 插件"));
  var statusEl = el("span", "fxp-status");
  statusEl.appendChild(el("span", "fxp-dot"));
  statusEl.appendChild(el("span", null, "检测中…"));
  head.appendChild(statusEl);
  var closeBtn = el("button", "fxp-close", "关闭");
  closeBtn.addEventListener("click", function () { modal.classList.add("fxp-hide"); try { localStorage.setItem(LS, "0"); } catch (e) {} });
  head.appendChild(closeBtn);

  var tabs = el("div", "fxp-tabs");
  var tabLogin = el("button", "fxp-tab on", "① 登录 / 会话");
  var tabSearch = el("button", "fxp-tab", "② 快速检索");
  tabs.appendChild(tabLogin);
  tabs.appendChild(tabSearch);

  var body = el("div", "fxp-body");

  // —— 登录页 ——
  var loginPane = el("div");
  loginPane.appendChild(el("div", "fxp-note",
    "登录方式：账号密码在下方【嵌入的法信登录页】里完成（密码只提交给 www.faxin.cn，" +
    "验证码/滑块照常人工处理一次）；成功后本插件即保存会话，检索工具可直接使用。若嵌入页异常，" +
    "请用“外部浏览器登录 → 粘贴 Cookie”兜底。"));

  var frameRow = el("div", "fxp-row");
  var openBtn = el("button", "fxp-btn2 ghost", "新窗口打开登录页");
  openBtn.addEventListener("click", function () { window.open(GW + "/login.aspx", "_blank"); });
  frameRow.appendChild(openBtn);

  var frame = el("iframe", "fxp-frame");
  frame.setAttribute("src", GW + "/login.aspx");
  frame.setAttribute("sandbox", "allow-scripts allow-forms allow-same-origin allow-popups");
  loginPane.appendChild(frameRow);
  loginPane.appendChild(frame);

  var verifyRow = el("div", "fxp-row");
  var verifyBtn = el("button", "fxp-btn2", "我已登录，验证会话");
  verifyBtn.addEventListener("click", function () { refreshStatus(true); });
  var clearBtn = el("button", "fxp-btn2 warn", "清除本地会话");
  clearBtn.addEventListener("click", async function () {
    await getJSON(API + "/cookies", { method: "DELETE" });
    await refreshStatus(true);
  });
  verifyRow.appendChild(verifyBtn);
  verifyRow.appendChild(clearBtn);
  loginPane.appendChild(verifyRow);

  loginPane.appendChild(el("div", "fxp-note",
    "兜底（推荐先试上方嵌入页）：用普通浏览器登录 https://www.faxin.cn 后，" +
    "在开发者工具(F12) → 网络/应用 里复制请求头中的 Cookie 一行，粘贴到下面并导入。"));

  var cookieTa = el("textarea", "fxp-ta");
  cookieTa.placeholder = "Cookie: 这一行或 k=v; k2=v2 …（含会话关键 cookie）";
  loginPane.appendChild(cookieTa);
  var importRow = el("div", "fxp-row");
  var importBtn = el("button", "fxp-btn2", "导入 Cookie");
  importBtn.addEventListener("click", async function () {
    var v = cookieTa.value.trim();
    if (!v) return;
    var r = await getJSON(API + "/cookies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cookie_header: v }),
    });
    alert(r && r.ok ? "导入成功：" + r.count + " 条" : "导入失败：" + ((r && r.error) || "未知错误"));
    if (r && r.ok) { cookieTa.value = ""; refreshStatus(true); }
  });
  importRow.appendChild(importBtn);
  loginPane.appendChild(importRow);

  // —— 快速检索页 ——
  var searchPane = el("div", "fxp-hide");
  var sKind = el("select", "fxp-sel");
  var kinds = [
    ["law", "法律法规（中央+地方）"],
    ["case", "裁判规则（付费库）"],
    ["lib", "专题库（条约/港澳/期刊/释义…）"],
    ["tiao", "法条直达（法规名+条号）"],
  ];
  kinds.forEach(function (k) {
    var o = el("option");
    o.value = k[0];
    o.textContent = k[1];
    sKind.appendChild(o);
  });
  var sLibWrap = el("span");
  var sLib = el("select", "fxp-sel");
  var libs = [
    ["gjty", "国家条约"], ["xgk", "香港法律"], ["amk", "澳门法律"],
    ["flqk", "法学期刊"], ["flsy", "法律释义"], ["lf", "立法资料"], ["sf", "司法文件"],
  ];
  libs.forEach(function (l) {
    var o = el("option"); o.value = l[0]; o.textContent = l[1]; sLib.appendChild(o);
  });
  sLibWrap.appendChild(sLib);
  sLibWrap.classList.add("fxp-hide");

  var sTimeliness = el("select", "fxp-sel");
  [["", "不限时效"], ["current", "现行有效"], ["invalid", "失效"], ["modified", "已被修改"], ["pending", "尚未生效"]]
    .forEach(function (t) {
      var o = el("option"); o.value = t[0]; o.textContent = t[1]; sTimeliness.appendChild(o);
    });

  var kw = el("input", "fxp-input");
  kw.placeholder = "关键词：法规名 / 条文原文 / 案由词（如 民法典 · 盗窃公私财物 · 买卖合同纠纷）";
  var tiao2 = el("input", "fxp-input");
  tiao2.placeholder = "条号：680 / 第六百八十条（法条直达模式）";
  tiao2.classList.add("fxp-hide");

  var kwRow = el("div", "fxp-row");
  kwRow.appendChild(sKind);
  kwRow.appendChild(sLibWrap);
  kwRow.appendChild(sTimeliness);
  kwRow.appendChild(el("span", "fxp-muted", "条数上限"));
  var maxN = el("input", "fxp-input");
  maxN.type = "number"; maxN.min = "1"; maxN.max = "50"; maxN.value = "10";
  maxN.style.maxWidth = "90px";
  kwRow.appendChild(maxN);
  searchPane.appendChild(kwRow);
  searchPane.appendChild(kw);
  searchPane.appendChild(tiao2);

  var goRow = el("div", "fxp-row");
  var goBtn = el("button", "fxp-btn2", "检索（结构化）");
  goBtn.addEventListener("click", doSearch);
  goRow.appendChild(goBtn);
  var copyBtn = el("button", "fxp-btn2 ghost", "复制 JSON");
  goRow.appendChild(copyBtn);
  searchPane.appendChild(goRow);

  var resultEl = el("div");

  sKind.addEventListener("change", function () {
    var k = sKind.value;
    sLibWrap.classList.toggle("fxp-hide", k !== "lib");
    tiao2.classList.toggle("fxp-hide", k !== "tiao");
    kw.classList.toggle("fxp-hide", k === "tiao");
    sTimeliness.classList.toggle("fxp-hide", k !== "law");
    resultEl.textContent = "";
  });

  var lastJson = null;
  function renderLawResults(d) {
    if (d.permissionDenied) {
      resultEl.textContent = "🔒 " + (d.message || "无权限");
      resultEl.classList.add("fxp-pre", "ok");
      return;
    }
    resultEl.classList.remove("fxp-pre", "ok");
    resultEl.textContent = "";
    if (!d.results || !d.results.length) {
      resultEl.textContent = "未找到相关结果。\n建议：换案由词/条文原文表述，或放宽时效。";
      resultEl.classList.add("fxp-pre", "ok");
      return;
    }
    var counts = d.counts || {};
    var headLine = el("div", "fxp-muted",
      "分库命中：" + Object.keys(counts).map(function (k) { return k + "=" + counts[k]; }).join(" ") +
      (d.timelinessApplied ? " ｜ 时效：" + d.timelinessApplied : ""));
    resultEl.appendChild(headLine);
    d.results.forEach(function (r) {
      var box = el("div", "fxp-item");
      box.appendChild(el("div", "t", r.title));
      var meta = [];
      if (r.lib) meta.push("库别:" + r.lib);
      if (r.group) meta.push("分组:" + r.group);
      if (r["公布"]) meta.push("公布:" + r["公布"]);
      if (r["施行"]) meta.push("施行:" + r["施行"]);
      box.appendChild(el("div", "fxp-muted", meta.join(" ｜ ") + " ｜ gid:" + r.gid));
      if (r.snippet) box.appendChild(el("div", null, r.snippet));
      resultEl.appendChild(box);
    });
  }

  async function doSearch() {
    var kind = sKind.value;
    var payload = {
      kind: kind,
      max_results: Math.min(50, Math.max(1, Number(maxN.value) || 10)),
    };
    if (kind === "tiao") {
      payload.law = kw.value.trim();
      payload.tiao = tiao2.value.trim();
    } else {
      payload.keyword = kw.value.trim();
      if (kind === "law") payload.timeliness = sTimeliness.value;
      if (kind === "lib") payload.lib = sLib.value;
    }
    if (kind !== "tiao" && !payload.keyword) { alert("请输入关键词"); return; }
    if (kind === "tiao" && (!payload.law || !payload.tiao)) { alert("请输入法规名和条号"); return; }
    resultEl.textContent = "检索中…（法信响应约 2-8 秒，请稍候）";
    resultEl.classList.remove("fxp-pre", "ok");
    var r = await getJSON(API + "/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    lastJson = r;
    if (!r.ok) {
      resultEl.textContent = "❌ " + (r.error || "检索失败");
      resultEl.classList.add("fxp-pre");
      return;
    }
    var d = r.data || {};
    if (kind === "law" || kind === "case" || kind === "lib") {
      renderLawResults(d);
    } else if (kind === "tiao") {
      resultEl.classList.remove("fxp-pre", "ok");
      resultEl.textContent = "";
      resultEl.appendChild(el("div", "t", (d.law || "") + " " + (d.tiao || "")));
      if (d.docNoDates) resultEl.appendChild(el("div", "fxp-muted", d.docNoDates));
      var pre = el("pre", "fxp-pre ok");
      pre.textContent = d.content || "";
      resultEl.appendChild(pre);
    }
  }
  copyBtn.addEventListener("click", function () {
    if (lastJson === null) return;
    var txt = JSON.stringify(lastJson, null, 2);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(function () { alert("JSON 已复制"); });
    } else {
      prompt("复制 JSON：", txt);
    }
  });

  body.appendChild(loginPane);
  body.appendChild(searchPane);
  searchPane.appendChild(resultEl);

  card.appendChild(head);
  card.appendChild(tabs);
  card.appendChild(body);
  modal.appendChild(card);
  document.body.appendChild(modal);

  tabLogin.addEventListener("click", function () {
    tabLogin.classList.add("on"); tabSearch.classList.remove("on");
    loginPane.classList.remove("fxp-hide"); searchPane.classList.add("fxp-hide");
  });
  tabSearch.addEventListener("click", function () {
    tabSearch.classList.add("on"); tabLogin.classList.remove("on");
    searchPane.classList.remove("fxp-hide"); loginPane.classList.add("fxp-hide");
  });

  // 状态轮询
  async function refreshStatus(force) {
    var r = await getJSON(API + "/status" + (force ? "?force=1" : ""));
    var dot = statusEl.querySelector(".fxp-dot");
    var label = statusEl.lastChild;
    if (r.ok) {
      dot.className = "fxp-dot ok";
      label.textContent = "已登录 · " + (r.liveCount || 0) + " cookie";
    } else {
      dot.className = "fxp-dot bad";
      label.textContent = "未登录（" + (r.diag || "?") + "）";
    }
  }

  var launcher = el("button", "fxp-btn", "法");
  launcher.title = "法信检索 · 登录与检索面板";
  launcher.addEventListener("click", function () {
    modal.classList.remove("fxp-hide");
    try { localStorage.setItem(LS, "1"); } catch (e) {}
    refreshStatus(true);
    frame.src = GW + "/login.aspx";
  });
  document.body.appendChild(launcher);

  // 兜底：无论上面哪里出问题，都再补一个可点入口（右上角红点，仅脚本早期失败时可能不出现）
  try {
    var alt = el("button", "fxp-btn", "法信");
    alt.title = "打开法信检索面板";
    alt.style.position = "fixed";
    alt.style.top = "12px";
    alt.style.right = "12px";
    alt.style.width = "auto";
    alt.style.height = "auto";
    alt.style.borderRadius = "18px";
    alt.style.padding = "8px 14px";
    alt.style.fontSize = "13px";
    alt.style.background = "#b03a2e";
    alt.addEventListener("click", function () {
      modal.classList.remove("fxp-hide");
      refreshStatus(true);
    });
    document.body.appendChild(alt);
  } catch (e) {}

  // 轮询状态（后台静默）
  setInterval(function () { refreshStatus(false); }, 20000);
  setTimeout(function () { refreshStatus(false); }, 800);

  // 自动展开：上次打开过或首次使用时自动弹出一次
  try {
    var seen = localStorage.getItem("faxin-panel-seen");
    if (localStorage.getItem(LS) === "1" || seen !== "1") {
      localStorage.setItem("faxin-panel-seen", "1");
      setTimeout(function () { launcher.click(); }, 1000);
    }
  } catch (e) {}
})();
