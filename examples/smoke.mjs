// 离线冒烟测试：node tests/smoke.mjs
// 覆盖：中文数字换算、Cookie 罐、HTML 解析（不触网）。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { cnToInt, intToCn, normalizeTiaoToCn, extractTiao } from "../lib/cn-num.mjs";
import { CookieJar } from "../lib/cookie-jar.mjs";
import { textify, scanBalanced, withoutScriptStyle } from "../lib/html.mjs";
import {
  parseFirstHtml,
  parseOutlineListHtml,
  parseTiaoHtml,
  parseDetailHtml,
} from "../lib/parse.mjs";

let n = 0;
function ok(name) {
  n += 1;
  console.log("ok " + n + " - " + name);
}

// —— 中文数字 ——
assert.equal(cnToInt("二百三十二"), 232);
assert.equal(cnToInt("一千二百六十"), 1260);
assert.equal(cnToInt("十"), 10);
assert.equal(cnToInt("577"), 577);
for (const [num, want] of [
  [105, "一百零五"],
  [108, "一百零八"],
  [577, "五百七十七"],
  [680, "六百八十"],
  [1260, "一千二百六十"],
  [11, "十一"],
  [19, "十九"],
  [20, "二十"],
  [1010, "一千零一十"],
  [1005, "一千零五"],
  [10, "十"],
]) {
  assert.equal(intToCn(num), want, `intToCn(${num})`);
}
assert.equal(intToCn(cnToInt("一百零八")), "一百零八");
ok("中文数字 换算含补零");

assert.equal(normalizeTiaoToCn("680"), "第六百八十条");
assert.equal(normalizeTiaoToCn("第六百八十条"), "第六百八十条");
assert.equal(normalizeTiaoToCn("第五百七十七条之一"), "第五百七十七条之一");
const seg = extractTiao("第一百零八条 本章不适用于……\n第一百零九条 后文……", "108");
assert.ok(seg && seg.startsWith("第一百零八条"), "extractTiao 应命中第一百零八条");
ok("条号标准化/提取");

// —— Cookie 罐 ——
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "faxin-"));
const jar = new CookieJar(path.join(dir, "session.json"));
jar.store(
  ["sid=abc123; Path=/; Domain=faxin.cn; HttpOnly", "uid=9; Path=/"],
  "https://www.faxin.cn/",
);
assert.equal(jar.headerFor("https://www.faxin.cn/alllibsearch/a.ashx"), "sid=abc123; uid=9");
assert.equal(jar.headerFor("https://wenshu.faxin.cn/x"), "sid=abc123");
jar.store(
  ["sid=; Path=/; Domain=faxin.cn; Expires=Thu, 01 Jan 1970 00:00:00 GMT"],
  "https://www.faxin.cn/",
);
assert.ok(!jar.headerFor("https://www.faxin.cn/").includes("sid="), "过期删除");
const imp = jar.importHeader("a=1; b=2; c=hello%20world");
assert.equal(imp.ok, true);
assert.ok(jar.headerFor("https://www.faxin.cn/").includes("a=1"));
const jar2 = new CookieJar(path.join(dir, "session.json"));
assert.ok(jar2.headerFor("https://www.faxin.cn/").includes("b=2"), "重载文件后仍可读");
ok("Cookie 罐 存取/过期/持久化");

// —— HTML ——
const doc =
  "<html><head><style>.x{}</style></head><body><div class='box fulltext'><p>第<b>一</b>条</p><p>内容</p></div><script>if('x'){}</script></body></html>";
assert.ok(!textify(doc).includes("x{}"));
const dStart = doc.indexOf("<div class='box fulltext'>");
const dEnd = scanBalanced(doc, dStart);
assert.ok(dEnd > 0, "scanBalanced 找到闭合");
assert.ok(withoutScriptStyle(doc).includes("box fulltext"));
ok("HTML 文本化/配对");

const firstHtml =
  "<li class='allmore'>司法解释（33）更多</li>" +
  "<li><div class='div-title'><a href='/lib/zyfl/zyflcontent.aspx?gid=A123'>最高人民法院关于审理买卖合同纠纷案件适用法律问题的解释</a></div>2020.12.29 公布 2021.01.01 施行 摘要文字</li>" +
  "<li><div class='div-title'><a href='/lib/zyfl/zyflcontent.aspx?gid=A124'>中华人民共和国民法典</a></div>2020.05.28 公布</li>";
const items = parseFirstHtml(firstHtml, "https://www.faxin.cn");
assert.equal(items.length, 2);
assert.equal(items[0].gid, "A123");
assert.equal(items[0]["公布"], "2020.12.29");
assert.equal(items[0]["施行"], "2021.01.01");
assert.equal(items[0].group, "司法解释（33）");
ok("FirstHtml 列表解析");

const tiaoHtml =
  "<a href='/lib/Zyfl/ZyflContent.aspx?gid=A999#680'>中华人民共和国民法典</a><br><span>主席令第四十五号 / 2020.05.28 公布 2021.01.01 施行</span>" +
  '<div class="zyfl_tiao_tiaoinfo"><span id="t_1"></span>第六百八十条 禁止高利放贷，借款的利率不得违反国家有关规定。<br/>第二款内容</div>';
const tiao = parseTiaoHtml(tiaoHtml, "https://www.faxin.cn");
assert.equal(tiao.gid, "A999");
assert.equal(tiao.law, "中华人民共和国民法典");
assert.equal(tiao.tiao, "第六百八十条");
assert.ok(tiao.content.includes("禁止高利放贷"), "条文内容");
ok("法条直达解析");

const kwHtml =
  '<a href="/keyword/KeyWordDetail.aspx?id=1001" title="A2.E6 合同纠纷">x<span class="fl num" >99+</span>买卖合同纠纷</a>';
const outlines = parseOutlineListHtml(kwHtml);
assert.equal(outlines.length, 1);
assert.equal(outlines[0].id, "1001");
ok("大纲概念列表解析");

const detailHtml =
  "<html><head><title>中华人民共和国民法典 - 法信 - 懂法更懂法律人</title></head>" +
  "<body><div class='js-sxTab'><p>时效性</p><p>现行有效</p><p>效力等级</p><p>法律</p></div>" +
  "<div class='box fulltext'><p>第一条 为了保护民事主体的合法权益…</p><p>第二条 民法调整平等主体…</p></div></body></html>";
const d = parseDetailHtml(detailHtml, "https://www.faxin.cn/x");
assert.equal(d.title, "中华人民共和国民法典");
assert.ok(d.content.includes("第一条"), "详情正文");
assert.equal(d.meta["时效性"], "现行有效");
ok("详情页 标题/正文/meta 解析");

console.log(`\n全部通过（${n} 组断言）。`);
