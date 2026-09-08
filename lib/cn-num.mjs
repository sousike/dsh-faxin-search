// 中文数字 <-> 整数（覆盖 1-9999，足够法条号场景：民法典 1260 条）
const CN_DIGIT = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const CN_NUM = "零一二三四五六七八九";

export function cnToInt(s) {
  const str = String(s || "").trim();
  if (/^\d+$/.test(str)) return parseInt(str, 10);
  if (!str) return null;
  let section = 0;
  let number = 0;
  for (const ch of str) {
    if (ch in CN_DIGIT) {
      number = CN_DIGIT[ch];
    } else if (ch === "十") {
      section += (number || 1) * 10;
      number = 0;
    } else if (ch === "百") {
      section += number * 100;
      number = 0;
    } else if (ch === "千") {
      section += number * 1000;
      number = 0;
    } else {
      return null;
    }
  }
  return section + number;
}

export function intToCn(n) {
  const num = Number(n);
  if (!Number.isInteger(num) || num <= 0 || num > 9999) return String(n);
  if (num <= 10) return num === 10 ? "十" : CN_NUM[num];
  const th = Math.floor(num / 1000) % 10;
  const hu = Math.floor(num / 100) % 10;
  const te = Math.floor(num / 10) % 10;
  const un = num % 10;
  let s = "";
  if (th) {
    s += CN_NUM[th] + "千";
    if (!hu && (te || un)) s += "零"; // 一千零五
  }
  if (hu) {
    s += CN_NUM[hu] + "百";
    if (!te && un) s += "零"; // 一百零八
  }
  if (te) {
    if (th === 0 && hu === 0 && te === 1) s += "十"; // 十一~十九 口语化
    else s += CN_NUM[te] + "十";
  }
  if (un) s += CN_NUM[un];
  return s;
}

const TIAO_RE = /第([一二三四五六七八九十百千零0-9]+)条(之[一二三四五六七八九十]+)?/g;

/** 条号输入 → 中文条号连写（577 → 第五百七十七条；第五百七十七条之一 → 原样） */
export function normalizeTiaoToCn(raw) {
  const s = String(raw || "").trim();
  const m = /^第?([一二三四五六七八九十百千零0-9]+)条?(之[一二三四五六七八九十]+)?$/.exec(s);
  if (!m) return null;
  const num = cnToInt(m[1]);
  if (num === null) return null;
  return "第" + intToCn(num) + "条" + (m[2] || "");
}

/** 从法条全文定位「第X条」片段（支持 577 / 第五百七十七条 / 之一） */
export function extractTiao(content, tiao) {
  const s = String(tiao || "").trim();
  const m = /^第?([一二三四五六七八九十百千零0-9]+)条?(之[一二三四五六七八九十]+)?$/.exec(s);
  if (!m) return null;
  const num = cnToInt(m[1]);
  if (num === null) return null;
  const suffix = m[2] || "";
  const cnNum = intToCn(num);
  const forms = new Set([cnNum, m[1]]);
  for (const form of forms) {
    const re = new RegExp("第" + form + "条" + (suffix ? suffix : "(?!之)"));
    const match = re.exec(content);
    if (!match) continue;
    TIAO_RE.lastIndex = match.index + match[0].length;
    const nxt = TIAO_RE.exec(content);
    const end = nxt ? nxt.index : Math.min(content.length, match.index + match[0].length + 2000);
    return content.slice(match.index, end).trim();
  }
  return null;
}
