# dsh-faxin-search（法信检索 · DSH 插件）

登录你自己的[法信](https://www.faxin.cn)账号后，为 DeepSeek Harness (DSH) 的 AI 提供**结构化法律检索工具**：法律条文、司法解释/司法文件、裁判规则（审判意见类内容）、法信大纲（法信码知识树）等，按“标题 / gid / 库别 / 公布与施行日期 / 时效性 / 条文全文”等字段返回。**可自动用于合同审查等任务中的法条与案例检索**。

## 功能
- **登录**：账号密码 + 一次人工验证（若有验证码/滑块照常处理）；会话 Cookie 只存本机，之后免重登。兜底：浏览器登录后粘贴 Cookie 导入。
- **检索工具（MCP，公共名 `mcp__faxin__*`）**：
  - `faxin_check_login` 会话检测（30 分钟缓存，`force=true` 强检）
  - `faxin_search_law` 法规检索（中央/地方，**时效筛选**：现行有效/失效/已被修改/尚未生效）
  - `faxin_get_tiao` **法条直达**：法规名（可简称）+条号 → 条文全文+文号+施行日期
  - `faxin_get_detail` gid 详情全文（含 meta 时效性/效力等级，可按条精确取）
  - `faxin_search_case` 裁判规则（编辑提炼的案例要旨；付费库以账号权限为准）
  - `faxin_search_lib` 专题库：国家条约/港澳法律/法学期刊/法律释义/立法资料/司法文件
  - `faxin_search_outline` / `faxin_get_outline` 法信大纲概念
  - `faxin_import_cookies` 手动导入会话
- **GUI 面板**：左下角“法”浮标——内嵌登录、会话状态、快速检索演示。

## 安装（DSH 客户端插件）
```bash
# 方式 A：CLI
dsh plugin --profile desktop add link:<本插件目录绝对路径>
# 方式 B：手动放入 profile（见 docs/使用说明.md），随后在 profile package.json 的
# dependencies 与 dsh.profile.bundles 中登记本插件名，并重启 DSH Desktop。
```

## 首次登录
1. 点左下角“法”→ 内嵌法信登录页用你自己的账号登录（密码只提交给 www.faxin.cn）；
2. 点“我已登录，验证会话”，状态变绿即可。会话过期属正常，重来一次即可。

## 检索使用建议
- 优先用**案由词**或**法条原文表述**（“买卖合同纠纷”“盗窃公私财物”）；抽象概念命中率低；
- 已知法规名+条号 → 直接 `faxin_get_tiao`；引用前用 `faxin_get_detail` 核对 **meta 时效性**；
- 裁判规则/类案等为付费库，账号无权限时工具会明确提示“库访问受限”；
- 请**低频使用**（裁判规则库尤其如此，频繁调用会触发平台临时限速）。

## 开发与运行
- 纯 Node（≥22）零外部运行时依赖；检索为带会话 Cookie 的 HTTP 调用。
- 单元冒烟：`node examples/smoke.mjs`（离线）。
- 目录：`index.mjs`（入口）· `lib/`（api/http/parse/cookie/gateway）· `server/mcp-server.mjs`（MCP stdio）· `panel/client.js`（面板）。

## 合规与致谢
发布与使用前请阅读 `NOTICE.md`（合规边界、免责声明、第三方致谢）。
接口形态参考：[Emnllawlab/faxin-mcp](https://github.com/Emnllawlab/faxin-mcp)（MIT）。

## License
MIT License（见 LICENSE）。
