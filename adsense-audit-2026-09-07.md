# AdSense 全网审计与修复记录（2026-09-07）

工具：`~/.cola/skills/adsense-site-auditor`（GitHub yantoumu/adsense-site-auditor-skill，73 项要求逐项核对）。
方法：3 个并行 worker 对 8 站全量实测（curl + DoH + 本地仓检查），73 ID × 8 站逐项给证据。

## 审计结论

**8 站全部「Ready after fixes」**：内容质量、原创性、爬虫可达性、ads.txt、所有权验证全部 Pass。
卡点集中在隐私合规类。两处工具口径修正：
- 「全员缺 CMP」为**误报**——Google CMP 是投放时动态注入，静态 HTML grep 不到；AdSense 后台实测 GDPR 消息已启用（9 条有效消息）。
- adventurers 的 224 词薄页实际是 `/patch-notes`（站内无 /updates 路由）。

## 修复清单（全部已上线验证）

| 站点 | commit | 修复项 |
|---|---|---|
| scrapmechanic-hub | e1dce39 (main) | Blocker：farming-trading 死链 /crafting-recipes 删除；新建 /terms；隐私补 web beacons/IP/Ads Settings 披露；sitemap+页脚加 terms |
| slay-the-spire-2-guide | d86bc99 + f67471d (main) | Blocker：隐私页重写（标准第三方披露+opt-out）；version-ledger 408→676 词、decision-lab 454→704 词、about 408→651 词 |
| cairn-guide | 673b6b4 (master) | 隐私标准段+opt-out；页脚加 About；about "single quiet slot" 失实表述改为 "may display advertising" |
| cropia-guide | cade971 (master) | 版本口径统一：Steam appdetails 实测 coming_soon=false (13 Aug, 2026) → contact 页去掉 early access；隐私补 Advertising 段 |
| town-to-city-guide | ea89176 (main) | sitemap 补 /terms（连带放开 noindex）；updates 689→1162 词、layouts 785→1150 词 |
| the-adventurers-guide | ebafcde (master) | /patch-notes 548→1485 词（Steam News API appid 3062500 真实公告：1.0 Release 2026-08-31、beta/live 双分支节奏、终版 demo），页头标注 LAST VERIFIED |
| twisted-tower-guide | — | 无需修（隐私政策是全网模板水平）；唯一 High（CMP）为审计误报 |
| thebigwalkguide.wiki | — | 隐私已达 Pass；唯一 High（CMP）为误报，无代码改动 |

## CMP（AdSense 后台实测 09:40）

- GDPR/欧洲法规消息：**已启用**（9 条有效消息）——无需动作。
- 美国州法规消息：未创建。可选推荐项，非审核门槛；向导 iframe 流程不配合自动化，如需可后台手动两分钟创建。

## 约束遵守

全程零新增数值：所有内容改动只复用仓内既有事实或 Steam API 实测原文；缺失来源的内容一律未写。

## 当前状态

8 站全部达到 Ready。等待 AdSense 审核（「正在准备」状态不变）。
