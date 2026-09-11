# AdSense 审核结果与迭代记录（2026-09-11）

## 后台实测状态（11:50，pub-8925824244664340）

| 站点 | 状态 | 提交时间 |
|---|---|---|
| twistedtowerguide.wiki | 09-04 02:30 出结果：**低价值内容** 拒绝 → 09-11 已完成内容迭代并**重新提交审核**（「已请求审核」，状态回「正在准备」） | 08-26 |
| cropia.wiki / towntocityguide.wiki / cairnguide.wiki / thebigwalkguide.wiki | 正在准备 | 08-26 |
| slaythespire2guide.wiki | 正在准备 | 08-27 |
| theadventurersguide.wiki | 正在准备 | 09-03 |
| scrapmechanichub.com | 正在准备 | 08-26 |

## 关键判读

1. **twisted 是全网首审出结果的站**，结论=低价值内容。这对其余 7 站是先导信号：审核阶段 Google 对本站群内容的裁定尺度以 twisted 为样本。若 twisted 重审通过，其余站按同标准排队的通过概率大增。
2. **后台「Ads.txt 状态」列 7 站显示「未找到」为陈旧记录**：匿名 + Googlebot UA 双通道实测 8 站 /ads.txt 全 200 且 publisher ID 正确（scrapmec 显示「已授权」佐证 Google 已抓到过）。无需修复，等 Google 自行刷新。
3. 重审策略：**不空手点重申**。09-04 被拒后站内无实质新增，先做真实内容扩充再提交。

## twisted 内容迭代（commit edf0dd7，main，已上线验证）

- 发现：仓内 `/updates` 已含 patch notes 板块，未新建路由避免重复内容（对复审有害）。
- 新增真实内容（全部来自 Steam News API appid 1575990 实测，全文存档仓内 `docs/evidence/steam-news-1575990-2026-09-11.json`）：
  - `/updates`：「Letters from the Tower...」(2026-08-21, v1.0.4.3.1)、「Join the Official Discord!」、「The Road to Launch」发布前时间线（2023-09-30 预告 → 2025-02-12 demo → 2026-07-08 定档 → 2026-08-10 125.4K wishlists + Noir Mode → 2026-08-18 发售）。
  - `/weapons`：「官方补丁改了什么」——v1.0.4.4.2 原文（Tommy Gun 特殊攻击机制证实、切枪不重置冷却等）。
  - `/puzzles`：grapple 捷径关闭、Casino 折返门等补丁修复事实。
  - `/wiki` 版本表补 v1.0.4.3.1；`/faq` 新增本地化问答。
- 未写（缺来源，遵守假数据铁律）：武器伤害数值、时钟谜题解法。

## 重审提交（自动化，CDP 19542 直连）

- 详情面板：勾选「我确认已解决相关问题」→ 点击「申请审核」。Angular Material 复选框对 JS 合成事件不响应，需 CDP `Input.dispatchMouseEvent` 真实坐标点击（aria-checked=true 确认后提交）。
- 提交后面板确认：所有权 ✅ + 已请求审核 ✅，行状态回「正在准备」。

## 环境变化

- Clash 代理端口 9676/9674 已失效，现为 **http://127.0.0.1:10090**。

## 后续

- twisted 重审结果通常数天~两周；出结果后核对。
- 若重审仍拒：下一个杠杆是把同 playbook 应用到其余 7 站的薄弱页（各站均有 Steam 公告数据可用）。
- 6 条 UNKNOWN 催抓项的 coverage-check 复跑仍待做（09-06 计划被审计插队）。
