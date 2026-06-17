# 产品术语与领域模型

Status: Draft checkpoint（对齐 PRD v0.2）  
Last updated: 2026-06-17  
Language: zh-CN

本文档定义产品术语和领域模型，目的是约束后续 PRD、roadmap、架构和代码命名，避免概念漂移。

## 语言约定

- 产品文档中使用 **Data Source / 数据源**，但定义中必须强调：Data Source 不是单个数据库连接，而是一套业务系统的数据入口。
- **Connection / 数据库连接** 指底层技术连接和凭据。
- **Playbook** 暂时保留英文，中文解释为“可复用调查流程”。
- 代码、类型、注释、测试、提交信息使用英文。

## Team

自部署实例里的默认团队空间。V1 一个部署实例默认一个 Team，用户基本无感。未来可以扩展为多 Team / Workspace。

Team 回答的问题是：谁属于这个自部署实例或团队空间？

## User

产品账号。用户没有全局固定角色；同一个用户可以在不同 Connection 或 Data Source 上拥有不同权限。

## Connection

Team 级技术资源，表示一个可连接的数据库端点和凭据，例如 `billing_prod_readonly`。

Connection 可被多个 Data Source 显式引用。Credential 只保存在 Connection 层，不复制到 Data Source。

Connection 负责：

- 数据库类型
- host / port / database
- credential / secret
- SSL / network configuration
- connection health
- credential rotation

## Connection Membership

用户对某个 Connection 的管理或复用权限。

V1 角色：

- **Owner**：创建者和最终负责人，可删除、转移、管理 Admin。
- **Admin**：可编辑连接、测试连接、旋转凭据、将 Connection attach 到 Data Source。

不设 Querier。普通查询用户不直接使用 Connection。

## Data Source

核心产品对象。一套业务系统的数据入口，由一个或多个 Connection 组成，并承载业务上下文、权限、策略、示例问题和调查历史。

用户面向 Data Source 提问，而不是面向 Connection 提问。

Data Source 回答的问题是：这套业务系统可以被团队如何安全地提问和调查？

## Data Source Connection

Data Source 对某个 Connection 的引用。它定义这个 Connection 在当前 Data Source 中的用途和范围，例如：

- alias
- purpose
- included / excluded tables
- field-level rules
- sensitive field handling
- schema snapshot reference
- context notes

同一个 Connection 可以被多个 Data Source 复用，但每个 Data Source 可以定义不同表/字段范围、业务语义和 Policy。

## Data Source Membership

用户在某个 Data Source 上的权限。

- **Owner**：创建者和最终负责人。天然是 Admin。可删除/归档 Data Source、转移 Owner、撤销 Admin。
- **Admin**：可编辑 Data Source、管理 context/policy/members、发布或归档、邀请 Querier。
- **Querier**：可在授权范围内提问、查看 Answer、查看与自己相关的 Evidence，不能编辑 Data Source。

## Policy

Data Source 的查询和展示规则，包括：

- 只读限制
- 自动执行条件
- 人工确认条件
- 行数限制
- 表/字段范围
- 敏感字段脱敏
- 查询超时
- 结果保留策略

Policy 是应用后端执行控制的依据，不是 AI 自行判断的建议。

## Schema Snapshot

系统从 Connection introspection 得到的结构元数据快照，包括表、列、类型、外键、索引、注释等。

AI 基于 Schema Snapshot 理解数据库结构，但不直接连接数据库。

## Data Source Context

给 AI 和用户使用的业务上下文，包括：

- Overview
- 系统边界
- 适合回答的问题
- 不适合回答的问题
- 业务注意事项
- 常见口径

## Business Glossary

业务词汇与指标口径，例如 revenue、spend、refund、active account、settlement date。

Business Glossary 可以由 AI 生成 Suggested 草稿，必须经 Admin 确认为 Verified 后才作为可靠上下文。

## Entity Mapping

业务实体与数据库结构之间的映射，例如 Customer、Campaign、Invoice 在哪些 connection/table/field 中出现，跨 connection 的关联键是什么。

Entity Mapping 用来帮助 AI 规划调查步骤和解释结果，但它不是事实来源。未验证的 mapping 不能作为强依据。

## Question

用户提出的自然语言问题，必须绑定到一个 Data Source。

## Investigation

围绕一个 Question 展开的调查过程，包括澄清、计划、SQL 生成、查询执行、结果解释、追问和 Answer。

## Investigation Thread（排查线程）

Investigation 的会话式、可恢复的呈现形态——产品的主交互面。一个 Thread 绑定一个 Data Source，持有有序的回合序列（提问、临时推理、澄清、持久 Answer），在历史列表中展示，并跨会话持久。在同一 Thread 延续同一业务意图是追问；改变意图或数据源则新建 Thread。「Investigation」是领域对象，「Investigation Thread」是用户体验到的形态。

## Query

AI 生成的 SQL 草案。Query 可以被安全检查、审查、拒绝或执行。

## Query Run

一次具体 SQL 执行记录，绑定：

- Connection
- SQL
- parameters
- execution time
- row count
- status
- error
- result summary
- safety classification

## Evidence

支撑 Answer 的证据材料，包括 Query Run、结果摘要、数据来源、时间范围、过滤条件、口径、assumptions 和 caveats。

## Answer

Investigation 产出的可交付回答，也是固定在 Investigation Thread 内、带版本的持久 artifact（不是临时聊天回复）。Answer 应包含：

- Summary
- Key Findings
- Evidence
- Assumptions
- Caveats
- Follow-up Questions

## Answer Version

一个 Investigation 内某个 Answer 的不可变版本。追问、澄清、重跑或经确认的口径修正都会在同一 Thread 内产生新的 Answer Version；历史版本仍可访问、绝不被静默覆盖。UI 默认显示最新版本。

## Suggested Correction（建议修正）

Querier 对某个 Answer 所用口径、映射或假设提出的异议（例如「花费应排除退款」）。它被捕获为一条 `Suggested` 修改，路由给该 Data Source 的 Admin 复核——绝不静默改动 Verified 上下文。这是把「提问」转化为「更好的数据源语义」的反馈闭环，同时保持 `Suggested → Verified` 纪律。

## Playbook

可复用调查流程。绑定 Data Source，描述某类问题的触发条件、必需输入、调查步骤、允许工具、答案格式和人工确认点。

Playbook 是产品中类似 coding agent skill 的概念，但不应在 UI 中叫 skill。它不是模型自动学习的黑盒记忆，而是团队确认过的可审查调查流程。

V1 可以保留概念和 roadmap 位置；完整 Playbook 编辑器和自动沉淀不进入 V1 主路径。

## Sample Data Source

系统内置的可执行示例 Data Source，使用轻量 demo 数据，不要求用户额外部署 sample database。

Sample Data Source 用于 onboarding、demo、QA 和 smoke test，可隐藏或删除。

## Relationship Rules

1. 一个 Team 拥有多个 Users、Connections、Data Sources。
2. Connection 是 Team 级资源，可被多个 Data Sources 显式引用。
3. Data Source 通过 Data Source Connection 引用 Connection。
4. Data Source Membership 决定用户能否使用或管理某个 Data Source。
5. Connection Membership 决定用户能否管理或复用某个 Connection。
6. Data Source Admin 不自动拥有 Team 内所有 Connection 的复用权。
7. Querier 永远不直接管理 Connection。
8. 同一个 Connection 被多个 Data Source 复用时，每个 Data Source 可拥有不同表/字段范围、业务语义和 Policy。
9. 编辑或禁用 Connection 时必须提示影响哪些 Data Source。
10. 删除 Connection 前必须解除所有 Data Source 引用，或仅允许禁用/归档。

## Data Source Lifecycle

```text
Draft -> Published -> Archived
```

- **Draft**：Owner/Admin 可见。可添加 Connection、补业务说明、跑 schema introspection、生成 AI draft、测试查询。Querier 不可见。
- **Published**：授权成员可见。Querier 可在 Ask Data 里选择并提问。
- **Archived**：不能再被提问，保留历史 Answer、Query Run 和 Evidence。

## Publish Requirements

发布 Data Source 前至少需要：

- 至少一个可用 Connection
- Data Source name
- 简短业务说明
- Schema Snapshot 已生成
- AI draft 已生成
- Admin 已确认基础 Business Glossary / Entity Mapping
- Policy 已设置
- 至少一个 Owner

