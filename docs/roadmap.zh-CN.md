# 产品 Roadmap 草案

Status: Roadmap v0.2 aligned with PRD v0.2  
Last updated: 2026-06-17  
Language: zh-CN

本文档记录阶段边界和未来扩展方向。它不替代 PRD，也不是实现计划。它的重点是区分“当前做什么”“为未来留什么口子”“当前明确不做什么”。

## Roadmap 原则

1. 先产品，后工程。
2. 先主流程，后系统能力。
3. 先 Data Source 和 Investigation，后 Playbook、Report、Monitor。
4. 每个功能默认不进入主界面，除非它让黄金路径更清楚。
5. 未来能力可以预留接口，但不能进入 V1 主路径。

## Phase 1: Self-hosted AI Data Investigation

目标：验证小团队能否把业务系统数据库封装成受控 Data Source，并通过 AI 完成可追溯的数据调查。

范围：

- Self-hosted Web App first。
- 一个部署实例默认一个 Team。
- PostgreSQL first：第一种真实业务数据库 adapter 是 PostgreSQL。
- 本地账号 + first-run bootstrap：首个完成 setup 的用户成为默认 Team 初始 Owner。
- Data Source 作为核心产品对象。
- Connection 作为 Team 级技术资源，可被 Data Source 显式引用。
- Data Source 内 Owner / Admin / Querier 三层角色。
- Connection 内 Owner / Admin 两层角色。
- Data Source lifecycle：Draft -> Published -> Archived。
- Backend Direct Connection：应用后端直接使用保存的连接凭据执行受控只读查询。
- 独立 metadata store：产品元数据不写入用户业务数据库。
- Connection credentials 应用级加密保存，secret manager 作为未来扩展。
- AI provider 通过环境变量或部署配置接入，主流程不暴露 provider/model/debug。
- Schema introspection 和 Schema Snapshot。
- Data Source Context、Business Glossary、Entity Mapping。
- Business Glossary / Entity Mapping 支持 Suggested -> Verified。
- 低风险只读查询可自动执行；高风险、不确定或越权查询需要确认或拒绝。
- Answer 必须带 Evidence。
- 会话优先的 Ask Data：可恢复的 Investigation Thread，含流式推理、历史列表、以追加新回合 / 新 Answer version 方式工作的追问，澄清作为对话回合处理。
- 带版本的持久 Answer artifact：latest-first、轻量 previous-answers 入口、不静默覆盖。
- 纠错反馈闭环：Querier 对口径/映射/假设的异议被捕获为给 Admin 复核的 Suggested 修改；绝不直接改动 Verified 上下文。
- Sample Data Source 使用轻量 demo 数据，不要求用户额外部署 sample database。
- UI 支持 English / 简体中文，Light / Dark。

明确不做：

- 写操作执行。
- 跨连接 SQL join 或虚拟大数据库。
- BI dashboard builder。
- 复杂 IAM。
- 多级组织审批流。
- 原生桌面 App。
- 监控告警。
- 插件市场。
- 公开 SaaS 多租户平台。

## Phase 2: Better Data Source Calibration

目标：让 Admin 更容易把“人脑中的业务口径”校准进 Data Source。

可能能力：

- 更好的 AI-assisted schema explanation。
- 敏感字段候选识别。
- 跨 Connection 的 entity mapping 建议。
- Data Source quality checklist。
- Data Source preview / test questions。
- Context drift review：当 schema 变化时提示哪些 glossary/mapping 可能需要复核。
- 导入/导出脱敏 Data Source context package，不包含凭据和真实数据。

边界：

- 仍不做完整数据治理平台。
- 仍不把 AI suggested context 自动当作事实。

## Phase 3: Manual Playbooks

目标：从成功 Investigation 中沉淀可复用调查流程。

可能能力：

- 将一次 Investigation 保存为 Playbook draft。
- 手动编辑 Playbook 的 trigger、required inputs、steps、allowed tools、answer format、confirmation points。
- Playbook versioning。
- Admin review 后启用或禁用 Playbook。
- Playbook 与 Data Source 绑定。

边界：

- 不让 AI 自动启用 Playbook。
- 不内置大量行业模板作为核心依赖。

## Phase 4: Suggested Playbooks and Reuse

目标：让系统在用户本地发现重复调查模式，并建议沉淀 Playbook。

可能能力：

- 在自部署实例内分析重复 Questions / Investigations。
- AI 建议 Playbook draft。
- Admin 审查后启用。
- Playbook run history。
- Playbook-specific Answer contracts。

隐私原则：

- 用户部署实例里的真实 schema、SQL、结果、glossary、investigation、playbook 默认不回传产品作者。
- 如果未来支持贡献模板，必须是用户主动 opt-in 的脱敏导出。

## Phase 5: Investigation-derived Reports

目标：从重复 Investigation / Playbook 生成可分享报告，而不是从零构建 BI dashboard。

可能能力：

- 从 Saved Investigation 生成 shareable Report。
- 从 Playbook 输出稳定结构的 Report。
- Report history。
- Answer 内轻量图表沉淀为 report section。
- 可分享但受权限控制的 Answer / Report 页面。

边界：

- 不做通用 dashboard builder。
- 不做复杂 chart editor。
- 不做 metric catalog 作为产品起点。

## Phase 6: Monitors and Alerts

目标：把高频、稳定、可信的调查流程转化为周期性监控。

可能能力：

- 定期运行 Playbook。
- 生成 periodic report。
- 异常条件配置。
- 通知到 Slack/email/webhook。
- Monitor evidence history。

边界：

- 只基于已验证的 Data Source Context / Playbook。
- 不做通用 observability 平台。

## Future: Execution Runtime Evolution

### V1 Decision: Backend Direct Connection

自部署 Web App 后端直接使用 Data Source 引用的 Connection 执行受控只读 SQL。

### Future Extension: Worker / Agent Runtime

查询执行可下沉到独立 worker、队列、隔离网络或本地 agent，用于：

- 隔离数据库网络访问。
- 支持长任务。
- 支持更强审计边界。
- 支持未来 hybrid / remote control plane。

### Explicit Non-goal for V1

V1 不做云端 SaaS 连接客户生产数据库，不做远程 agent，不做跨环境执行调度。

## Future: Multi-connection and Federated Query

### V1 Decision

支持多连接理解、多步单连接查询、AI 汇总。每条 SQL 在一个 Connection 内执行。

### Future Extension

未来可接入 federated query engine、warehouse、materialized snapshots 或专用分析层。

### Explicit Non-goal for V1

V1 不做强一致跨库查询，不做跨连接 SQL join，不做全局查询优化。

## Future: Native App / Desktop Companion

### V1 Decision

Self-hosted Web App first。

### Future Extension

Desktop companion 可用于 DBA/工程师本地连接、调试、数据源管理或离线开发体验。

### Explicit Non-goal for V1

V1 不做 DBeaver 式原生 SQL IDE。

## Future: Protocol and Extension Boundaries

V1 不做通用插件市场或 VS Code 式扩展宿主，但核心能力应按稳定边界设计：

- Connector Interface
- Query Executor Interface
- Agent Tool Contract
- Playbook Spec
- Theme Tokens
- I18n Message Catalog
- Data Source Package export/import

未来可评估：

- MCP integration：把本产品能力暴露给外部 AI 工具，或接入外部工具。
- Desktop companion integration。
- Community starter templates。

## Future: Conversational Affordances

V1 交付会话优先的 Investigation Thread，但有几项 AI 助手能力被刻意排除在 V1 主路径之外，未来在「确实让通向可信 Answer 的路径更清楚」时才引入：

- 把某条 Answer 或 Evidence 作为追问的上下文附件。
- 在 composer 中 `@` 提及某个 Verified 术语或实体。
- 从 composer 调用已保存的 Playbook（依赖 Phase 3）。
- 命令面板（如 ⌘K）用于新建排查、切换数据源、搜索历史。
- 把 Answer 内的图表沉淀进 Report（依赖 Phase 5）。

边界：以上任何一项都不能把 Thread 变成通用聊天机器人，也不能暴露 provider/model/debug。见 PRD `Interaction Non-goals`。

## Next Discussion Reminder

下次继续 roadmap 时，优先确认：

1. V1 的最小可实现切片是否覆盖完整黄金路径。
2. Answer Contract 是否足够稳定，可以作为 smoke test 目标。
3. 哪些 roadmap 能力需要从第一天预留数据模型字段，哪些只需要文档边界。
