# AI Data Portal PRD

Status: PRD v0.3 reviewable draft  
Last updated: 2026-06-17  
Language: zh-CN

本文档记录下一轮产品实验的第一版产品定义。它不是实现计划，也不是最终交互/技术规格。它的目标是定义产品定位、用户、边界、黄金路径、核心对象和验收标准，为后续实现计划提供稳定输入。

> **v0.2 修订说明。** 该版采用「会话优先」的 AI 时代交互模型（参考 Claude Desktop 这类现代 AI 助手），同时完整保留所有信任与安全边界：新的 `Interaction Model` 一节，把 **Investigation Thread（排查线程）** 确立为一等交互面；明确「追问 vs 新建排查」规则；引入**纠错反馈闭环**;引入 **Unblock Path**,让每个非答案都可操作;显式给出 Status × Confidence 合法组合矩阵;以及轻量的快捷操作 / 命令入口。可评审原型位于 `prototypes/prototype.html`。
>
> **v0.3 修订说明（开发就绪）。** 该版补齐进入 tech spec 所需的缺口:新增 `Success Measurement and Validation Signals`（护栏 + 价值 + 反向信号,以及继续/迭代/转向/停止的决策规则,全部在自托管隐私边界内）；新增 `Roles and Capability Matrix`（角色能力矩阵）；新增 `Application States and Errors`（非顺利路径的产品级行为目录）；新增 `Implementation Milestones`（M0/M1/M2,把 V1 切成可独立演示的步骤）；以及无障碍基线。同时记录了此前两个开放产品问题的推荐决策——`Cross-Connection Comparison Scope`（D1）与 `Evidence Redaction and Visibility`（D4）——只把它们的实现机制留给 tech spec。`product-next` 是一个独立产品,后续将放入它自己的 repo,不继承父目录 `docs/` 的文件。以上新增不改变安全模型:仍然是 AI 提议、应用控制。

## 产品定位

短定位：

> 小团队自部署的 AI Data Portal：连接数据库，校准业务语义，用对话完成可信的数据调查。

正式目标句：

> 帮助小团队把内部数据库封装成受控的 AI 数据入口，让成员无需数据库凭据或 SQL 熟练度，也能通过对话获得可信、可追溯的数据答案。

这个产品不是 AI 版 DBeaver，也不是轻量 BI。它的核心价值是让小团队把业务系统背后的数据库连接、业务语义、权限策略和查询证据组织成可被 AI 安全使用的数据调查入口。

## 产品目标

1. 让小团队在自部署环境中安全连接内部数据库，避免把数据库凭据分发给每个数据请求者。
2. 把一个或多个数据库连接组织成面向业务系统的 Data Source，而不是让用户直接面对裸连接和表结构。
3. 让 Admin 通过 AI-assisted workflow 校准数据源的业务语义，包括业务说明、实体映射、字段解释、口径和限制。
4. 让 Querier 在授权范围内用自然语言提出业务问题，并获得带证据的 Answer。
5. 让每次 Investigation 保留 SQL、数据来源、参数、假设、限制和结果摘要，方便复核、交接和未来复用。
6. 为后续 Playbook、Report、Monitor 等能力留下产品和技术接口，但不让它们干扰 V1 主路径。

## 目标用户

### V1 主要设计对象：技术型数据请求处理者

V1 主要服务经常替业务查数、排查客户或业务对象问题的人：

- Product Engineer
- Full-stack Engineer
- Support Engineer / Customer Success Engineer
- Technical Operator

他们通常懂业务系统，有一定数据库概念，但不想每次都手写 SQL，也不希望团队成员直接拿数据库凭据。他们经常需要围绕 customer、account、order、campaign、invoice 等业务对象回答临时数据问题。

### Data Source Owner / Admin

有数据库访问权限的人负责把一套业务系统封装成可用 Data Source：

- 创建和管理数据库 Connection
- 校准 Data Source Context
- 设置查询边界和脱敏规则
- 邀请团队成员使用

### V1 支持但不作为主要设计对象：业务、运营、产品同事

业务、运营、产品同事可以作为 Querier 使用已发布且校准良好的 Data Source。V1 不以完全非技术用户为主要设计目标。等 Data Source Context、Business Glossary、Playbook 和 Answer trust mechanisms 成熟后，再在 roadmap 中提升他们的优先级。

### 次级用户

- DBA / Platform Engineer：关心连接安全、只读、审计、查询成本，但 V1 不做 DBA 管理套件。
- Engineering Manager：关注可复核答案和团队调查知识沉淀，但不是日常主操作用户。

## 核心痛点

1. **对象级数据调查难以快速启动**  
   技术型数据处理者经常要回答具体业务对象的问题，但不知道该查哪个 Data Source、哪些表、哪些字段、哪些业务口径可信。

2. **现有 SQL 客户端流程不可交接**  
   工程师或支持人员在 SQL 客户端里手写 SQL、截图、复制结果给业务方。SQL、参数、过滤条件、假设和限制很难被复核或复用。

3. **数据库访问和数据需求错位**  
   业务、运营、产品需要答案，但不应该获得数据库凭据。团队需要一个只读、可授权、可脱敏、可限制成本的数据调查入口。

4. **AI 写 SQL 不等于可信答案**  
   AI 可以生成 SQL 和解释，但如果没有业务语义、权限策略、安全检查、受控执行和证据链，答案无法被信任或交接。

5. **业务口径和调查经验沉淀不足**  
   小团队的关键口径常在人的脑子里。状态含义、软删除规则、退款字段、时间口径、跨库 ID 关系和相似调查流程缺少可复用沉淀。

## 产品原则

1. **Ask first, inspect when needed**  
   用户从问题开始，而不是从 schema tree 或 SQL editor 开始。SQL 永远可查看，但不总是阻塞执行。

2. **Data Source over Connection**  
   用户面向 Data Source 提问。Connection 是底层技术资源，不能成为 Querier 的主心智。

3. **AI proposes, app controls**  
   AI 提出计划和 SQL；应用负责安全检查、授权、执行、脱敏、记录和 evidence。

4. **Business semantics are verified, not assumed**  
   AI 可以建议 glossary/entity mapping，但 Admin 确认后才成为可靠上下文。

5. **Every answer needs evidence**  
   Answer 必须说明查了什么、怎么得出结论、有哪些假设和不确定性。

6. **Start from investigations, grow into insights**  
   V1 聚焦具体业务对象的数据调查。Reports、Monitors、Dashboard-like views 只能从重复 Investigation / Playbook 中自然沉淀。

7. **Product surface stays simple**  
   每个功能默认不进主界面，除非它让黄金路径更清楚。Provider、session、fixture、debug、artifact 等工程概念不进入主流程。

8. **Self-hosted trust boundary**  
   用户的 schema、SQL、结果、业务口径、Investigation、Playbook 默认留在自部署实例内。

9. **Launch with bilingual UI and light/dark themes**  
   V1 UI 支持 English / 简体中文，支持 light / dark。代码、注释、测试、提交信息使用英文。

10. **Conversation is the surface, the Answer is the artifact**  
    主交互面是一个可恢复的 Investigation Thread（排查线程），而不是表单。用户在连续对话中提问、细化、追问；每个可信 Answer 都是固定在该线程内、带版本的持久 artifact。这正是让产品像现代 AI 工具、而不是查询表单的关键——同时又不让它退化成无边界聊天机器人。

11. **Agentic but inspectable, never noisy**  
    Agent 可以像优秀的 AI 助手那样流式展示推理、提出计划、并在高风险步骤前暂停确认。但临时推理是渐进披露，不是交付物：完成后折叠为 `What I Did`。工程内部细节（provider、model、raw tool payload、debug trace）永不出现在线程里。

## 非目标

1. 不是 SQL IDE / DBeaver 替代品。SQL 可审查，但 schema tree、SQL editor、多标签查询不是主入口。
2. 不是 BI dashboard builder。V1 不做 dashboard 创建、metric catalog、图表编辑器或周期报表工作流；图表只能作为 Answer 的辅助表达。
3. 不是数据仓库、ETL 或 federated query engine。V1 不搬运业务数据，不做跨库虚拟大表，不承诺跨连接 SQL join 或强一致跨库分析。
4. 不是公开 SaaS 平台。V1 面向小团队自部署，不做公开注册、多租户商业化、计费或云端连接客户生产数据库。
5. 不是全员无限制自然语言查数入口。用户只能在被授权的 Data Source 内提问。
6. V1 不执行写操作或数据库管理操作。可以生成 mutation SQL 草案和风险说明，但不能在产品内执行。
7. AI 不直接访问数据库、不持有凭据、不自动扩大权限。AI 只提出计划、SQL 或 tool call；应用后端负责校验、授权、执行、脱敏和记录。
8. AI 生成的业务语义不自动视为事实。Business Glossary / Entity Mapping 默认是 Suggested，必须经 Admin 确认为 Verified。
9. 自部署实例中的 schema、SQL、结果、业务口径、Investigation、Playbook 默认不回传产品作者。
10. V1 不做复杂 IAM、多级组织审批流、原生桌面 App、监控告警或插件市场；这些只进入 roadmap。

## 黄金路径

1. **Admin creates a Data Source**  
   Admin 创建一个 Data Source，例如 `Advertising Platform`，代表一套业务系统的数据入口。

2. **Admin attaches one or more Connections**  
   Admin 创建或复用已有 Connection，测试连接可用性。Connection 是 Team 级技术资源，Data Source 通过引用使用它。

3. **System introspects schema**  
   后端读取 schema metadata，生成 Schema Snapshot。AI 不直接连接数据库。

4. **AI drafts Data Source Context**  
   AI 基于 schema 和 Admin 输入生成业务系统摘要、核心实体、字段解释、关系、敏感字段候选和示例问题。

5. **Admin verifies context and policy**  
   Admin 确认 Business Glossary / Entity Mapping，设置只读、行数限制、敏感字段、自动执行条件、人工确认条件等 Policy。

6. **Admin publishes the Data Source**  
   Data Source 从 Draft 变为 Published。只有被授权的 Owner/Admin/Querier 能看到和使用。

7. **Querier asks a question**  
   Querier 在 Ask Data 中选择 Data Source，提出自然语言问题，例如“为什么 ACME 这个月广告账单比上个月高？”

8. **Agent runs a controlled investigation**  
   Agent 使用 Data Source Context、Verified mappings 和 Policy 生成调查计划。低风险只读查询可自动执行；高风险、不确定或越权请求需要确认或拒绝。

9. **System returns an Answer with Evidence**  
   Answer 包含结论、关键事实、数据来源、SQL/evidence、假设、限制、不确定性和建议追问。

10. **Investigation is saved for review and reuse**  
    Investigation 保存 Question、计划、Query Runs、Evidence、Answer 和 caveats。未来可用于复查、交接，或沉淀 Playbook。

## User Stories

### Owner

- 作为 Owner，我想创建 Data Source，把一套业务系统的数据连接、业务语义和权限边界封装起来。
- 作为 Owner，我想邀请 Admin/Querier，让团队成员在不同权限下使用同一个 Data Source。
- 作为 Owner，我想管理 Data Source 的生命周期：Draft、Published、Archived。
- 作为 Owner，我想看到 Data Source 被问过什么、执行过哪些查询、是否有风险。
- 作为 Owner，我想转移 ownership 或撤销 Admin，确保最终责任可控。

### Admin

- 作为 Admin，我想创建或复用数据库 Connection，并测试连接是否可用。
- 作为 Admin，我想让 AI 扫描 schema，生成业务实体、字段解释、敏感字段和关系草稿。
- 作为 Admin，我想补充业务说明，确认或修改 Business Glossary / Entity Mapping。
- 作为 Admin，我想设置 Data Source Policy，包括只读、行数限制、敏感字段、自动执行和确认规则。
- 作为 Admin，我想在发布前测试示例问题，确认 Answer 是否可信。
- 作为 Admin，我想维护 Data Source 上下文，让 AI 以后回答更稳定。

### Querier

- 作为 Querier，我想打开产品后看到自己可用的 Data Sources。
- 作为 Querier，我想选择一个 Data Source，用自然语言问业务问题。
- 作为 Querier，我想在不接触数据库凭据、不写 SQL 的情况下获得答案。
- 作为 Querier，我想在需要时看到 AI 的调查计划、SQL 和数据来源。
- 作为 Querier，我想知道答案的假设、口径和不确定性。
- 作为 Querier，我想继续追问、复查历史 Investigation，或把 Answer 交给业务方。

### First-run / Sample

- 作为新用户，我想在没有连接真实数据库前体验 Sample Data Source，快速理解产品价值。
- 作为 Admin，我想参考 Sample Data Source，知道一个配置良好的 Data Source 应该包含什么。
- 作为开发者或维护者，我想用 Sample Data Source 跑 smoke test，验证 Ask Data 到 Answer 的主流程没有坏。

## Navigation and First Screen

V1 主导航只保留两个心智入口：

1. **Ask Data**：用户选择已授权 Data Source，然后提问。
2. **Data Sources**：Owner/Admin 创建、配置、校准、发布和管理 Data Source。Querier 可以查看自己有权限的数据源说明和示例问题，但不能编辑。

不作为 V1 主导航：

- Dashboard / Insights
- Playbooks
- Approvals
- Audit Logs
- Connections
- Provider Settings
- Debug
- Sessions
- Artifacts

首次部署且没有真实 Data Source 时，首屏优先展示产品价值，而不是配置复杂度。首屏只应出现：

- 一句话定位：`Self-hosted AI Data Portal for trusted data investigations`
- 主按钮：`Try Sample Data Source`
- 次按钮：`Create Data Source`
- 2-3 个 sample questions
- 简短安全说明：数据库凭据保存在本实例；AI 不直接执行 SQL；查询由后端安全检查和只读执行

已有可访问 Data Source 后，默认进入**会话优先的 Ask Data 界面**。空状态下展示居中的 composer（含问候语）、内嵌在 composer 里的 Data Source 选择器、3-4 个示例问题，以及 Recent Investigations 区域。用户提问后，界面转为 Investigation Thread（见 `Interaction Model`）。最近排查的历史列表是一等且常驻的界面；Data Sources 和设置作为次要入口。

## Interaction Model

本节定义 AI 时代的交互模型：问题、推理、答案、追问和纠错如何作为连续体验运作。它细化（而不是替代）Answer Contract 与 Architecture Boundaries。参照对象是现代 AI 助手（可恢复线程、流式推理、持久 artifact、行内引用），并受本产品信任模型约束。

### Investigation Thread

Investigation 是**一等、可恢复的会话线程**，不是一次性事务。

- 一个 Thread 在其生命周期内只绑定一个 Data Source。要排查不同的业务系统，用户需新建 Thread。
- 一个 Thread 包含有序的回合：用户提问、临时推理、澄清，以及持久 Answer（每个都是带版本的 artifact）。
- Thread 在历史列表中展示（如按「今天 / 更早」分组），可打开、可恢复、可重命名，并跨会话持久保存。
- 打开一个 Thread 会恢复其最新 Answer 及其产生路径。历史不能被静默覆盖。

### Composer

Composer 是提问与追问的唯一入口，携带轻量上下文——绝不携带工程噪音。

- **Data Source 选择器内嵌在 composer 中**（胶囊形态），让当前数据源始终可见、可切换，但数据源永不成为主心智。
- Composer 在两处复用：空状态时居中，进入线程后停靠在底部。
- 从 composer 提交会在当前 Thread 追加一个新回合（不替换之前的 Answer）。
- Roadmap 入口（不进 V1 主路径，但预留设计）：把某条 Answer 或 Evidence 作为追问的上下文附件；`@` 提及某个 Verified 术语或实体；从 composer 调用已保存的 Playbook。

### Streamed Reasoning（临时）

Investigation 运行时，agent 可以把进度以有序步骤流式展示（识别业务对象、生成只读 SQL、执行查询、汇总）。这与 `Transient Investigation Updates` 规则一致：步骤进行中显示，完成后折叠进 `What I Did`，若某步失败、被 Policy 阻止或需澄清则保留可见。流式推理只是呈现，不是交付物，且永不暴露 provider/model/raw payload。

### Answer as a Durable Artifact

每个可信 Answer 都是固定在 Thread 内、带版本的持久 artifact，遵循完整 Answer Contract。它是被复核、交接、以及（未来）沉淀为 Playbook 或 Report 的单元。行内引用（Key Finding → Evidence 引用，如 `E1`）让读者能从一条结论跳到支撑它的 Query Run。

### Follow-up vs New Investigation

这解决了此前的一个开放问题，并同时约束历史与版本：

- **追问（follow-up）** 延续同一 Thread、同一业务意图——细化、下钻、回答澄清、修正口径或重跑。追问会追加一个新回合，并在同一 Investigation 内产生**新的 Answer version**。历史版本仍可通过轻量的「previous answers」入口访问。
- **新建排查（new Investigation）** 在用户改变业务意图或数据源时发生。它是一个全新 Thread，拥有独立的历史条目。
- V1 启发式：同一 Data Source + 延续前一话题 ⇒ 追问（新版本）；不同 Data Source 或无关话题 ⇒ 新 Thread。当确实含糊时，agent 先询问再分叉。

### Clarification as a Conversational Turn

`Needs Clarification` 是对话中的一个回合，不是死胡同。Agent 说明它需要什么（如缺失的时间范围、或在两种口径中用哪一种），并提供用户可直接点选的具体选项。回答澄清是一次追问，产生下一个 Answer version。

### Correction & Feedback Loop

当 Querier 对某个 Answer 使用的口径、映射或假设提出异议（例如「花费应排除退款」），产品把它捕获为一条 **Suggested** 修改，路由给该 Data Source 的 Admin 复核——绝不静默改动 Verified 上下文。这弥补了一个缺口:Querier 的提问往往是「数据源语义不完整」的最快信号；同时保持 `Suggested → Verified` 纪律。Admin 确认该建议后可触发重跑，产生新的 Answer version。

### Unblock Path（受阻时的下一步）

非 `Answered` 状态绝不是死胡同。每当 agent 澄清、拒绝或返回不可靠状态（见 `Decision Boundaries`），Answer 必须携带两样东西:**What's Missing（缺什么）**——把具体阻塞物精确点名（哪个术语、哪条未验证映射、缺哪个时间范围、缺哪项授权、或哪个含糊口径）——以及 **How to Move Forward（怎么推进）**——一个或多个用户可直接点选的具体下一步。这把「诚实」变成「有用」,避免校准滞后时被当成「AI 很笨」。

每个 Decision Boundary 触发条件对应一个前进动作:

| 触发条件 | 缺什么 | 前进动作 |
|---|---|---|
| 业务对象不清 | 哪个实体 / 记录 | 让用户指定,或从候选中选 |
| 缺时间范围 | 一个时间窗 | 行内时间选择器,或建议的默认值 |
| 越权表/字段 | 访问范围 | 解释范围;(roadmap) 申请权限并路由给 Admin |
| 需要写操作 | 不适用(只读) | 提供 mutation SQL 草案 + 风险说明,绝不执行 |
| 多个可能口径 | 用哪个口径 | 行内点选;可把选择存为 Suggested 术语修改 |
| 跨连接无 Verified 映射 | 一条已验证映射 | 「通知 Admin 验证」→ 生成待复核的 Suggested 映射 |
| 结果不足以支撑结论 | 更窄 / 替代的问题 | 建议一个细化后的问题 |

「通知 Admin / 申请验证」动作复用 Correction & Feedback Loop 机制:它们为 Admin 生成 `Suggested` 条目,绝不直接改动 Verified 上下文。Admin 解决阻塞后,重跑可产生下一个 Answer version。Unblock Path 必须保持轻量(一句「缺什么」加一小组动作按钮),不能把拒答变成一堵配置墙。

### Quick Actions on an Answer

每个持久 Answer 上有一组小而一致的操作，保持界面整洁:重跑（产生新版本）、复制/交接（给业务同事的、尊重权限的可分享摘要）、以及（roadmap）保存为 Playbook。快捷操作不能挤占「读懂结论」。

### Keyboard & Command Affordances

轻量、增量、且永不强制:一个命令入口（如 ⌘K）用于新建排查、切换数据源或搜索 Thread 历史。它们是会话优先模型的加速器，不能引入与 Ask Data 竞争的独立高级用户界面。

### Interaction Non-goals

会话优先模型**不**会把产品变成通用聊天机器人。它仍受授权 Data Source、Safety Gate 和 Answer Contract 约束。具体而言:不支持脱离 Data Source 的自由聊天，不支持高风险步骤无确认的无边界多工具自主，不在线程里暴露 provider/model/debug，不用临时聊天回复替代持久 Answer。

## Prototype Discussion Rule

凡涉及产品功能界面，先讨论低保真网页原型，再进入实现。原型可以是临时 HTML/CSS 页面、文本线框、流程图或截图；当功能需要讨论布局、密度、状态、中英文、light/dark、响应式时，应优先使用网页原型。

达成共识后的原型应落库，作为实际开发参考。落库内容可以包括：

- prototype HTML source
- representative screenshots
- short product notes
- linked PRD section

原型定义信息层级、交互状态和产品意图，不等于最终视觉设计，也不应被当作生产代码。

会话优先模型的可评审低保真原型已落库于 `prototypes/prototype.html`。它是一个自包含的单文件 HTML，覆盖首屏/空状态、会话优先的 Ask Data 界面（内嵌数据源选择器的 composer、流式推理、带折叠 SQL/证据的持久 Answer、以追加新回合方式工作的追问）、Data Sources 列表/概览，以及 Admin 校准/策略/发布流程。它支持中英文与明暗主题切换。它只编码信息层级与交互状态，不是最终视觉设计。

## UI Failure Criteria

UI 视为失败，如果：

1. 用户第一次打开 10 秒内不知道应该“选择数据源并提问”或“创建数据源”。
2. 首屏上内部概念比 Ask Data 更显眼，例如 provider、session、artifact、fixture、debug、review decision。
3. 用户以为这是 SQL IDE，需要先浏览 schema、打开 SQL editor、手写 SQL 才能开始。
4. 用户以为这是 BI，需要先创建 dashboard、metric、chart 才能开始。
5. Querier 必须理解 Connection、Policy、Entity Mapping 才能提问。
6. Admin 创建 Data Source 时被迫一次性完成复杂数据治理建模。
7. Answer 只给结论，不给 SQL/evidence、数据来源、口径、假设和不确定性。
8. 每个局部功能都正确，但黄金路径“创建受控 Data Source -> 提问 -> 带证据 Answer”被淹没。
9. 中文/英文或 light/dark 任一组合下，主流程文字溢出、重叠或看不清。
10. 图表、debug、history、settings 等辅助功能抢占了主提问流程。
11. 线程退化为通用聊天机器人：持久 Answer 被临时聊天回复替代、追问丢失了 Evidence/Assumptions、或 agent 在所选 Data Source 授权范围外自由发挥。

## Answer Contract

Answer 是一次 Investigation 的当前可交付结果。它不是聊天回复，也不是完整 BI 报告。它必须让用户回答三个问题：

1. 结论是什么？
2. 这个结论依据什么数据？
3. 我应该在多大程度上相信它？

### Durable Answer Fields

1. **Status**  
   Answer 必须有明确状态：

   - `Answered`
   - `Partial`
   - `Needs Clarification`
   - `Blocked by Policy`
   - `No Reliable Answer`

   对任何非 `Answered` 状态，Answer 必须包含一句 **What's Missing（缺什么）** 和至少一个具体 **Next Step（下一步）**（见 `Interaction Model → Unblock Path`）。只说「无法得出结论」而不给前进路径的非答案是不完整的。

2. **Direct Answer**  
   一句话直接回答用户问题。不能完整回答时，必须明确说只能部分回答或无法可靠回答。

3. **Confidence**  
   使用语义等级，不使用百分比：

   - `High`
   - `Medium`
   - `Low`
   - `Cannot Determine`

   Confidence 必须附原因。例如：`Medium confidence because spend and invoice data come from separate Connections and invoice timing may lag usage events.`

   **Status × Confidence。** Status 与 Confidence 是相互独立的两个维度，必须一致地组合：

   | Status | 允许的 Confidence | 说明 |
   |---|---|---|
   | `Answered` | High / Medium / Low | 完整回答也可能是 Low（如跨 Connection 的近似对账）；原因里必须说明为什么。 |
   | `Partial` | Medium / Low / Cannot Determine | 只回答了部分子问题；整体绝不能声称 High。 |
   | `Needs Clarification` | Cannot Determine | 尚无结论；它是等待输入的对话回合。 |
   | `Blocked by Policy` | Cannot Determine | 执行被 Safety Gate / Policy 拒绝；没有数据支撑的结论。 |
   | `No Reliable Answer` | Cannot Determine / Low | 数据不足以支撑结论。 |

   `Answered` + `High` 要求证据完整、单一可信来源，且没有实质性的未验证假设。

4. **What I Did / Investigation Steps**  
   简短说明调查路径，例如 resolved customer identity、compared billing periods、checked campaign spend、checked invoices and adjustments。它可以默认折叠，但应作为持久内容保留。

5. **Key Findings**  
   每条 finding 必须绑定至少一个 Evidence item。没有 Evidence 的内容不能写成事实结论。Finding 可以关联 chart。

6. **Evidence**  
   每个 Evidence item 包含：

   - purpose
   - Data Source
   - Connection
   - tables
   - Query Run
   - result summary
   - SQL，默认折叠
   - execution metadata
   - policy notes

7. **Assumptions & Definitions**  
   说明本次回答采用的时间范围、过滤条件、指标定义、状态枚举、关联键，以及使用了哪些 Verified Business Glossary / Entity Mapping。

8. **Caveats / Uncertainty**  
   说明数据缺口、未验证 mapping、跨 Connection 汇总限制、口径差异、查询截断/脱敏，以及需要人工确认的地方。

9. **Charts**  
   可选。Chart 是 Answer 的辅助表达，不是 dashboard。Chart 必须绑定 Evidence。V1 只支持自动生成的 table、bar、line、simple comparison，不进入图表编辑器。

10. **Recommended Follow-ups**  
    提供 2-3 个自然追问，帮助用户继续调查。

11. **Version Metadata**  
    包含 answer version、created at、created after which clarification/follow-up，以及 latest/current marker。

### Evidence Rules

- SQL 默认折叠，但 Evidence 必须可见、可追溯、可展开。
- 每个 Key Finding 必须至少关联一个 Evidence item。
- Evidence 可以包括 SQL、结果摘要、执行时间、行数、脱敏状态、安全分类和 Policy notes。
- Query Run 和 Evidence 需要绑定到具体 Answer version，而不是只绑定到整个 Investigation。

### Answer Versioning

底层模型应支持一个 Investigation 拥有多个 Answer versions。每次澄清、追问、重新查询或修正口径，都可以生成新的 Answer version。区分「新版本（同一 Thread）」与「新建排查（新 Thread）」的规则见 `Interaction Model → Follow-up vs New Investigation`。

V1 UI 默认显示 latest Answer，并提供轻量入口查看 previous answers。历史 Answer 不能被静默覆盖。

### Transient Investigation Updates

运行中可以显示临时进度，但它们不是 Answer。例如：

- 正在识别客户
- 正在生成只读 SQL
- 正在执行 billing 查询
- 正在汇总结果

展示规则：

- 当前步骤进行中时显示。
- 进入下一步后自动消失或折叠。
- 完成后可折叠为 `What I Did`。
- 如果某一步失败、被策略阻止、需要用户澄清，则保留为可见事件。
- 不展示 provider、raw tool payload、debug trace 等内部细节。

### Decision Boundaries

AI 不应直接给 Answer，而应进入澄清、拒绝或不可可靠回答状态，如果：

1. 缺少明确业务对象。
2. 缺少关键时间范围。
3. 问题涉及未授权表/字段。
4. 需要写操作。
5. 多个可能口径会导致不同答案。
6. 跨 Connection 关联没有 Verified mapping。
7. 查询结果不足以支持结论。

以上每一种情况都必须遵循 `Unblock Path`:点名缺什么并给出具体下一步，而不是结束对话。

## Success Criteria

1. **10 秒理解**  
   新用户第一次打开产品，10 秒内能理解：我可以选择 Data Source 提问，或创建一个 Data Source；这不是 SQL IDE，也不是 BI dashboard。

2. **受控数据源创建**  
   Admin 能创建一个 Data Source，连接至少一个数据库，生成 Schema Snapshot，并完成基础业务上下文校准。

3. **授权提问**  
   Querier 能在不接触数据库凭据、不写 SQL 的情况下，对已授权 Data Source 提问。

4. **可信 Answer**  
   Answer 必须包含 Direct Answer、Key Findings、Evidence、Assumptions、Caveats、Confidence、Follow-ups。

5. **Evidence 可复核**  
   每个 Key Finding 至少关联一个 Evidence item；SQL 默认折叠但可展开。

6. **AI 不越权**  
   AI 不能直接执行 SQL，不能访问凭据，不能绕过 Data Source Policy，不能自动扩大权限。

7. **知道何时不回答——并指出前进路径**  
   当缺少对象、时间范围、权限、Verified mapping 或数据不足时，系统应澄清、拒绝或返回 No Reliable Answer，而不是硬答。每个非答案都点名缺什么并给出具体下一步（见 `Interaction Model → Unblock Path`），让诚实保持有用。

8. **主界面不暴露工程噪音**  
   首屏不出现 provider、session、artifact、fixture、debug、review decision 等内部概念。

9. **双语和主题可用**  
   English / 中文、Light / Dark 四种组合下主流程可读、无溢出、无重叠。

10. **Sample Data Source 可验证主流程**  
    用户不连接真实数据库，也能用 Sample Data Source 完成 Ask Data -> Investigation -> Answer with Evidence。

## Failure Criteria

1. 用户以为它是 SQL IDE。
2. 用户以为它是 BI dashboard builder。
3. 用户必须先理解 Connection / Policy / Entity Mapping 才能提问。
4. Answer 只有自然语言结论，没有 Evidence。
5. AI 对不确定问题编出确定答案。
6. Admin 创建 Data Source 像在做完整数据治理平台。
7. Debug/internal controls 比主路径更显眼。
8. 类似问题不能被复查、交接或作为未来 Playbook 的材料。

## Success Measurement and Validation Signals

V1 是一个产品实验:验证小团队能否把业务数据库封装成受控 Data Source,并通过对话获得可信、可复用的答案。上面的 Success Criteria 是能力的通过/不通过检查;本节定义在这些能力具备后,如何判断产品是否真的「成立」,以及什么情况下继续、迭代、转向或停止。

### 度量边界

度量必须遵守自托管信任边界。信号来自本地、实例内的事件日志,默认留在部署内、绝不回传。未来若为产品学习而导出,必须是显式 opt-in 且脱敏(与隐私原则一致)。V1 不带任何外部分析。

### 护栏信号（必须恒成立——任何违反即阻断发布）

这些是不变量,不是用来优化的指标:

- 0 次 AI 绕过 Safety Gate 执行 SQL。
- 0 次把数据库凭据、完整 secret 或未授权字段发送给 AI provider。
- 100% 的 Key Finding 至少引用一个 Evidence。
- 100% 已执行查询为只读,并记录为 Query Run。

### 价值信号（「成立」长什么样）

方向性信号,附首版目标供实现规划细化——不是合同数字:

- **首个可信答案耗时（Querier）:** Querier 在已发布数据源上,首次提问后几分钟内得到带 Evidence 的 `Answered`/`Partial` 结果。
- **可回答率:** 达到 `Answered` 或 `Partial` 的问题占比,对比那些卡在反复 `Needs Clarification` / `No Reliable Answer` 而不转化的。健康的产品会借 Unblock Path 把多数非答案转化掉。
- **校准成本（Admin）:** Admin 能在大约一次专注会话内把一个真实库做成可用的已发布数据源(目标约 30 分钟,后续细化)。如果这感觉像数据治理工作,产品就背离了核心承诺。
- **信任参与度:** 至少展开过一次 Evidence/SQL 的 Answer 占比,以及被交接或复用的 Answer 占比。从不被打开的 Evidence 可能意味着「完全信任」或「被忽略」,需结合复用率一起看。
- **Unblock 转化率:** 在非答案中,用户采取前进动作(选口径/设范围/通知 Admin)并最终拿到答案的占比。
- **纠错闭环健康度:** Querier 提出的 Suggested 修正数量,以及后续被 Admin Verified 的占比——证明提问正在随时间改进数据源语义。

### 反向信号（说明产品没站住）

- Admin 在发布前放弃校准。
- Querier 首次会话后不再回来。
- 非答案率高,即便有 Unblock Path 也不转化。
- 产生了 Answer 但从不被交接或复用(没有下游价值)。

### 决策规则

在第一个真实团队使用期之后:若核心闭环能产出被复用的可信答案、且 Admin 校准成本可接受,则**继续/扩大**;若价值信号参差但护栏成立,则**迭代**;若 Querier 拿得到答案但 Admin 不愿持续校准(校准模型错了),则**转向**;若即便校准好的数据源也产不出用户信任的答案,则**停止**。无论价值信号如何,护栏违反都一律阻断发布。

## Language and Theme Requirements

- V1 UI 支持 English / 简体中文。
- AI 回答默认跟随用户问题语言；语言不明确时回退到用户偏好的回答语言，再回退到 UI 语言。
- V1 支持 Light / Dark。
- 需要验收四种组合：English + Light、English + Dark、中文 + Light、中文 + Dark。
- 代码、注释、测试、提交信息使用英文。
- 面向产品理解的总领文档提供中英文版本。
- **无障碍基线（V1）:** 黄金路径界面(Ask Data 线程、composer、Answer、数据源列表/配置)必须完全可键盘操作,为交互元素暴露有意义的标签/角色,并在四种语言 × 主题组合下满足 WCAG AA 对比度。流式推理更新应以礼貌方式播报(不抢占焦点)。完整 WCAG 合规进入 roadmap;本基线属于 V1。

## Roles and Capability Matrix

角色按资源划分,不是全局的。同一用户可在不同 Connection 和 Data Source 上持有不同角色。首个完成 first-run bootstrap 的用户成为默认 Team 的初始 Owner。

| 能力 | Conn. Owner | Conn. Admin | DS Owner | DS Admin | DS Querier |
|---|---|---|---|---|---|
| 创建 Connection | —（创建者成为 Owner） | — | — | — | — |
| 编辑/测试/轮换/禁用 Connection | ✓ | ✓ | — | — | — |
| 删除/转移 Connection | ✓ | — | — | — | — |
| 把 Connection attach 到 Data Source | ✓ | ✓ | 仅当同时是 Conn. Owner/Admin | 仅当同时是 Conn. Owner/Admin | — |
| 创建 Data Source | — | — | —（创建者成为 Owner） | — | — |
| 运行自省 / 生成 AI 草稿 | — | — | ✓ | ✓ | — |
| 验证 Business Glossary / Entity Mapping | — | — | ✓ | ✓ | — |
| 编辑 context / Policy / 成员 | — | — | ✓ | ✓ | — |
| 发布 / 归档 Data Source | — | — | ✓ | ✓ | — |
| 邀请成员 / 分配 DS 角色 | — | — | ✓ | ✓（不能授予 Owner） | — |
| 删除 / 转移 ownership | — | — | ✓ | — | — |
| 查看 Draft 数据源 | — | — | ✓ | ✓ | — |
| 在已发布数据源上提问 | — | — | ✓ | ✓ | ✓ |
| 查看 Answer / Evidence（授权范围内） | — | — | ✓ | ✓ | ✓ |
| 提出 Suggested 修正 | — | — | ✓ | ✓ | ✓ |

横切规则:身为 Data Source Admin 绝不自动获得 Connection 复用权——attach 一个 Connection 需要在该 Connection 上拥有 Connection Owner/Admin。Querier 永不管理 Connection,也永不看到 Draft 数据源。凭据只存在于 Connection 层,绝不通过 Data Source 或 Evidence 界面暴露(另见 `Application States and Errors`）。

## Application States and Errors

Answer Contract 定义了「答案」的状态;本节定义产品其余部分在非顺利路径下的行为。原则:每个状态都以产品语言命名并给出下一步(与 `Unblock Path` 一致);原始堆栈、SQL 错误、provider 错误和 secret 永不展示给 Querier。

### Connection 状态

`未测试 → 测试中 → 健康 / 鉴权失败 / 不可达 / TLS 错误 / 已禁用`。Connection 在测试为「健康」前不能 attach 到 Data Source。失败状态展示产品级原因和修复动作(如「凭据被拒——更新后重测」);错误文本绝不回显 secret。禁用或编辑 Connection 前必须列出受影响的 Data Source。

### Schema Snapshot 状态

`运行中 → 完成 / 部分 / 失败`。部分(因授权不足某些表不可读)是一等结果:快照标记为 Partial,校准在可读表上继续进行,不可读区域被标注以便 Admin 了解覆盖缺口。失败提供重试并给出产品级原因。

### 查询执行状态（在某个 Investigation 回合内）

每种对应一个 Answer 状态和一条 Evidence 说明:`被 Safety Gate 阻止` → `Blocked by Policy`;`超时` / `连接丢失` → `Partial` 或 `No Reliable Answer` 并记录失败;`零行` → `Answered`/`No Reliable Answer` 并明确「无匹配数据」;`截断` → 按 Policy 限制并附 Caveat。Querier 看到的是产品级结果和 Unblock 选项,而非原始错误。

### 各界面 UI 状态

每个主界面都定义空、加载、错误、无权限四种状态:

- **空:** 没有数据源(→ 首屏/空状态),还没有 Investigation(→ composer + 示例),没有历史。
- **加载:** 线程、列表、Schema Snapshot 用骨架屏;进行中的 Investigation 由流式推理覆盖。
- **无权限:** Querier 访问 Draft 或未授权数据源时,看到清晰的「对你不可用」,而非泄露其存在(超出 Policy 允许)的 404。
- **错误:** 加载失败提供重试;绝不暴露内部标识符、provider 名或堆栈。

### 数据源发布就绪

未满足发布清单(见 `Sample Data Source` / Glossary 的发布要求)的 Draft,精确展示缺哪些前置条件以及各自的去处,而不是一个没有解释的禁用按钮。

### Provider 不可用 / 配置错误

若 AI provider 不可达或配置错误,Admin 在 provider 页看到状态;Querier 看到优雅的「排查暂不可用,请稍后重试」——绝不展示原始 provider/配置细节。任何提问都不应静默失败。

## Product-level Architecture Boundaries

本节不是详细技术设计，而是产品必须保持的执行和信任边界。后续架构文档和实现计划必须遵守这些边界。

### AI Execution Boundary

AI 不直接访问数据库、不持有数据库凭据、不执行 SQL。AI 只能提出计划、SQL 草案或 tool call request。

应用后端负责：

- 加载 Data Source Context、Verified Business Glossary、Verified Entity Mapping 和 Policy。
- 将必要且受限的上下文提供给 AI。
- 校验 AI 生成的 SQL 或 tool call。
- 授权、执行、脱敏、截断、记录查询结果。
- 只把受限结果摘要或必要样本交给 AI 解释。

### V1 Execution Runtime

V1 采用 **Backend Direct Connection**：

- 自部署 Web App 后端使用 Connection 中保存的凭据连接数据库。
- 查询执行发生在团队自己的部署环境中。
- SQL 执行必须经过 Safety Gate。
- V1 只执行受控只读查询。

未来可以扩展为 Worker / Agent Runtime，但这不是 V1 主路径。Worker Runtime 可用于隔离网络、长任务、队列、审计边界或未来 hybrid control plane。

### SQL Safety Gate

所有 SQL 在执行前必须经过确定性安全检查。Safety Gate 至少需要判断：

- 是否只读。
- 是否命中允许的 Connection。
- 是否访问允许的表和字段。
- 是否触发敏感字段或脱敏规则。
- 是否需要行数限制、时间范围或查询超时。
- 是否需要用户确认。
- 是否包含写入、DDL、权限、维护或管理命令。

Safety Gate 拒绝的查询不能执行。AI 不能覆盖 Safety Gate 的判断。

### Result Redaction and Bounded Context

查询结果进入 AI 解释前必须被限制：

- 按 Policy 脱敏敏感字段。
- 截断大结果集。
- 优先传递聚合、摘要、样本和 schema-aware result summaries。
- 不把数据库凭据、完整 secret、未经授权字段或不必要原始数据发送给 AI provider。

产品默认假设 AI provider 是外部服务，因此必须最小化发送给模型的数据。

### Schema Snapshot Boundary

Schema introspection 由应用后端执行。AI 使用的是 Schema Snapshot，而不是直接访问数据库。

Schema Snapshot 可以包含表、列、类型、外键、索引、注释和统计摘要。它是 AI 理解结构的上下文，但不等于业务事实。业务事实必须通过 Verified Business Glossary、Verified Entity Mapping 和实际 Query Run 支撑。

### Evidence Recorder

每次 Query Run 都必须记录足够的 evidence metadata，包括：

- Data Source
- Connection
- SQL
- parameters or parameter summary
- execution status
- execution time
- row count
- result summary
- safety classification
- redaction/truncation notes
- related Answer version

这保证 Answer 可以复核、交接，并为未来 Playbook 提供材料。

### Provider Boundary

AI provider 是可替换依赖，不应成为主界面概念。V1 可以有 provider 配置，但不能让 Querier 在主流程中看到 provider、model、raw prompt、raw tool payload 或 debug trace。

Provider 变更不应改变产品核心语义：Data Source、Policy、Evidence、Answer Contract 必须保持稳定。

## Cross-Connection Comparison Scope (D1)

决策:V1 支持跨连接*对比*,绝不支持跨连接 *SQL*。

agent 可以对每个 Connection 分别运行只读查询,然后在推理层对受限结果做对比或对账(如「A 库用量 vs B 库发票」)。每条 SQL 仍然只在一个 Connection 内执行——没有跨连接 JOIN、没有虚拟表、没有强一致的跨库事务(这些仍是 Non-goals)。

条件与护栏:

- 跨连接对比需要关联键的 Verified Entity Mapping。没有它,agent 不猜——而是返回 Unblock Path(「通知 Admin 验证映射」)。
- 跨连接结论必须附带关于时间/一致性的 Caveat(数据源之间可能互相滞后),且不得评为 `High` Confidence。
- 对比只在已经过 Safety Gate 返回的、受限且脱敏的结果摘要上进行——绝不把原始跨源行超出 Policy 限制发给模型。

备选方案:**(A,选定)** 受限的逐连接查询 + 推理层对比,以 Verified 映射为门槛;(B) 把所有跨连接能力推到 roadmap——否决,它会让常见的对账问题在 V1 无法回答;(C) 联邦 / 虚拟 join——否决,违反 Non-goals。原型里的跨连接示例演示了方案 A,包括映射未验证时的 Unblock Path。

Tech-spec 输入:逐连接的部分结果如何关联、对比的受限上下文大小、以及具体的 Confidence 上限。

## Evidence Redaction and Visibility (D4)

决策:脱敏延伸到 Evidence 展示层,沿用与执行相同的 Policy——不存在单独的、更弱的展示规则。

Querier 在 Evidence 中看到的是 Policy 受限后的形态:敏感字段值被脱敏,数据源授权范围外的标识符与 schema 引用被遮蔽或省略,展示的 SQL 是「按已执行、受 Policy 约束」的语句(而非任意内部 SQL)。凭据和 secret 对任何角色都绝不出现在 Evidence 中。

可见性按角色区分:

- **Querier:** 授权范围内、经 Policy 脱敏的 Evidence——SQL 可查但受限,敏感值被遮蔽。
- **Data Source Admin / Owner:** 为校准和复核可看更完整的 Evidence,但仍绝不含原始凭据。

当脱敏或截断影响了展示内容时,Answer 以 Caveat 注明(与 Answer Contract 和 Evidence Rules 一致)。

备选方案:**(A,选定)** Evidence 脱敏 = 执行 Policy,按角色区分;(B) 对任何有数据源权限的人展示完整 SQL/Evidence——否决,会把敏感字段名/值和范围外 schema 泄露给 Querier;(C) 对 Querier 完全隐藏 SQL——否决,违反「每个答案都要有证据 / SQL 可查」。

Tech-spec 输入:遮蔽的表示形式(如 `‹redacted›` 还是省略)、是否在展示的 SQL 中遮蔽敏感*列名*(而不仅是值),以及 Admin 与 Querier 的详情边界。

## V1 Product Scope

V1 的目标是完成一个端到端、可验证的产品闭环：Admin 创建并发布一个受控 Data Source；Querier 针对该 Data Source 提问；系统执行受控只读 Investigation；最终返回带 Evidence 的 Answer。

### In Scope for V1

1. **Self-hosted Web App**  
   一个部署实例默认一个 Team。Team 是内部容器，不作为主界面概念。

2. **User and membership basics**  
   支持 User、Data Source Membership、Connection Membership。Data Source 角色为 Owner / Admin / Querier。Connection 角色为 Owner / Admin。

3. **Connection management**  
   支持创建、测试、禁用或复用 Connection。Connection 是 Team 级技术资源，只有拥有 Connection 权限的人可以将其 attach 到 Data Source。

4. **Data Source lifecycle**  
   支持 Draft -> Published -> Archived。Draft 只对 Owner/Admin 可见，Published 对授权成员可见，Archived 保留历史但不可再提问。

5. **Data Source calibration**  
   支持 schema introspection、Schema Snapshot、AI-generated context draft、Business Glossary、Entity Mapping、Suggested -> Verified。

6. **Policy basics**  
   支持只读限制、表/字段范围、行数限制、查询超时、敏感字段脱敏、自动执行条件、人工确认条件。

7. **Ask Data flow（会话优先）**  
   Querier 可以选择已授权 Data Source，在一个可恢复的 Investigation Thread 中用自然语言提问，获得流式推理、澄清、带 Evidence 的持久 Answer，并能继续追问（追加新回合 / 新 Answer version）。历史列表展示最近的 Investigations。详见 `Interaction Model`。

8. **Controlled read-only execution**  
   AI 只提出计划和 SQL。应用后端通过 Safety Gate 校验后执行只读查询。

9. **Answer Contract**  
   Answer 必须包含 Status、Direct Answer、Confidence、What I Did、Key Findings、Evidence、Assumptions、Caveats、Recommended Follow-ups 和 Version Metadata。

10. **Evidence and Query Runs**  
    每次 Query Run 记录 SQL、来源、状态、结果摘要、安全分类、脱敏/截断说明，并绑定到 Answer version。

11. **Sample Data Source**  
    提供不要求额外部署数据库的可执行 Sample Data Source，用于 onboarding、demo、QA 和 smoke test。

12. **Bilingual UI and themes**  
    支持 English / 简体中文，Light / Dark。代码、注释、测试、提交信息使用英文。

13. **Basic AI provider configuration**  
    V1 需要足够的 provider 配置能力让自部署实例可运行，但 provider/model/debug 不能成为 Querier 主流程概念。

### Roadmap-only for V1

以下能力可以保留接口或文档边界，但不进入 V1 主路径：

- Playbook editor
- AI-suggested Playbook activation
- Report / Monitor / Alert
- Dashboard builder
- Complex IAM
- Multi-step organizational approval workflow
- Native desktop app
- Plugin marketplace
- Worker / Agent Runtime
- Federated query engine or cross-Connection SQL join
- Public SaaS multi-tenant platform

## Implementation Milestones

V1 范围较大;它以三个可独立演示的里程碑交付,按「产品风险从高到低」排序。这是对 roadmap Phase 1 的切片,不改变范围。

### M0 — 在 Sample Data Source 上跑通可信闭环（无真实数据库）

目标:验证最大的未知——一个可信 Answer 到底「可不可信」?构建会话优先的 Ask Data 线程、流式推理、完整 Answer Contract(Status、Direct Answer、Confidence、Key Findings、带折叠 SQL 的 Evidence、Assumptions、Caveats、Follow-ups、版本)、追加回合的追问、Unblock Path,以及中英文 + 明暗——全部基于可执行的 Sample Data Source。无真实 Connection,无校准编辑。这是冒烟测试主干,用最低成本给 Answer Contract 去风险。

### M1 — 真实 PostgreSQL 与受控执行

目标:在真实库上验证安全/执行机制。加入 first-run bootstrap + 本地账号、Connection 管理、schema 自省 / Schema Snapshot、Backend Direct Connection、SQL Safety Gate、只读执行、结果脱敏与有限上下文、Evidence Recorder、独立 metadata store、凭证加密。M1 之后,闭环可在真实 PostgreSQL Connection 上运行。

### M2 — 校准、发布与团队角色

目标:让真实数据源可被团队使用。加入 AI 起草的 Data Source Context、带 `Suggested → Verified` 的 Business Glossary 与 Entity Mapping、Policy 配置、Draft → Published → Archived 生命周期、带能力矩阵的 Data Source 与 Connection 成员、纠错反馈闭环,以及最小的 provider 状态/配置页。

每个里程碑对应 Success Criteria 的一个子集,并附带各自的验收检查。Roadmap Phase 2+ 仍属 V1 之后。

## Sample Data Source

Sample Data Source 是一个可执行示例数据源，不只是静态 UI 示例。它使用轻量 demo 数据，不要求用户额外部署 sample database。它必须：

- 明确标记为 Sample。
- 支持完整 Ask Data -> Investigation -> SQL/evidence -> Answer 闭环。
- 可隐藏或删除。
- 可用于 onboarding、demo、QA 和 smoke test。

如果后续需要验证真实 PostgreSQL adapter 路径，可以提供可选 full sample stack，例如 Docker Compose profile，但不能作为普通用户部署的必需条件。

## V1 Product Decisions

以下决策作为 PRD v0.1 的第一版假设。后续实现计划可以细化技术方案，但不应改变这些产品边界，除非先更新 PRD。

1. **第一种真实数据库类型：PostgreSQL first**  
   V1 的第一种真实业务数据库 adapter 明确为 PostgreSQL。产品术语保留 Connection 的泛化空间，但 implementation planning 以 PostgreSQL read-only path 为第一目标。Sample Data Source 可使用轻量 demo adapter；可选 full sample stack 可用于验证 PostgreSQL 路径。

2. **用户认证与首个管理员：本地账号 + first-run bootstrap**  
   V1 使用自部署实例内的本地账号系统。实例首次启动且没有用户时，第一位完成 setup 的用户成为默认 Team 的初始 Owner。后续用户通过邀请加入。SSO、OIDC、SCIM 或企业身份集成进入 roadmap。

3. **AI provider 配置：部署配置优先，设置页只做状态与最小管理**  
   V1 通过环境变量或部署配置接入 AI provider。产品可以提供 Admin-only provider 状态页或最小配置页，但 provider/model/debug 不进入 Querier 主流程。Local model 支持不作为 V1 必需能力。

4. **Connection credential storage：应用级加密，secret manager 留作扩展**  
   V1 必须加密保存 Connection credentials，并要求部署方提供 encryption secret。未来可接入外部 secret manager。凭据只保存在 Connection 层，不复制到 Data Source，不发送给 AI provider。

5. **Metadata storage：独立产品元数据库**  
   Team、User、Connection、Data Source、Policy、Investigation、Answer、Evidence 等产品元数据必须存储在产品自己的 metadata store 中，不能写入用户业务数据库。用户业务数据库只作为被查询的数据源。

6. **默认 Policy：严格、安全、低惊喜**  
   V1 默认只读、限制行数、限制查询超时、折叠 SQL、记录 Query Run。缺少时间范围、可能扫描过大范围、涉及敏感字段、跨 Connection 汇总或使用未验证 mapping 时，默认需要确认或澄清。具体阈值在实现计划中确定。

7. **Answer version UI：latest first，历史轻量可见**  
   底层模型支持多个 Answer versions。V1 UI 默认显示 latest Answer，并提供轻量入口查看 previous answers。不做复杂 diff、branch 或版本管理界面。

8. **V1 chart 范围：先 table 和 simple comparison**  
   V1 Answer 可包含 table 和 simple comparison。bar/line chart 进入近端 roadmap，除非实现成本很低且不影响主流程。V1 不做 chart editor。

9. **Result retention：默认保留摘要和 Evidence，原始大结果受限**  
   V1 默认保留 Answer、Evidence、Query Run metadata、result summaries。原始大结果集默认不长期保存或按严格限制保存。Admin 可配置 retention 是 roadmap 能力；V1 可以先使用安全默认值。

10. **业务用户 onboarding：支持但不主导**  
    V1 支持业务/运营/产品同事作为 Querier 使用已发布 Data Source，但 onboarding 和主体验仍优先服务技术型数据请求处理者。专门面向非技术业务用户的引导、权限申请和更强解释层进入 roadmap。

## PRD Self-review

### Consistency Check

- 产品定位保持为小团队自部署 AI Data Portal，没有回到 SQL IDE 或 BI dashboard builder。
- Data Source 是主产品对象，Connection 是底层技术资源。
- AI 不直接执行 SQL、持有凭据或绕过 Policy。
- Answer Contract 与 Success Criteria 一致：可信答案必须有 Evidence、Assumptions、Caveats 和 Confidence。
- Roadmap 能力没有进入主导航或 V1 黄金路径。

### Known Tensions

- V1 同时引入 Data Source Membership 和 Connection Membership，会增加模型复杂度，但这是为了避免“复用 Connection 等于间接获得数据库入口”的权限漏洞。
- Data Source calibration 是必须步骤，但必须保持轻量，否则 Admin 会感觉在做完整数据治理。
- Provider 配置是自部署运行所需，但不能暴露为 Querier 主流程概念。
- Answer versioning 底层需要支持，但 UI 必须保持轻，不应变成复杂版本管理工具。
- Sample Data Source 必须可执行，但不能增加普通部署的数据库依赖。
- PostgreSQL first 是实现收敛，不是产品永久边界。产品术语需要继续保留未来多数据库 adapter 的空间。
- 会话优先模型必须保持有边界。可恢复线程 + 流式推理 + 快捷操作让产品像现代 AI 工具，但每一个新增都离「嘈杂的通用聊天机器人」更近一步。Interaction Non-goals 与 UI Failure Criteria 是护栏:会话丰富的是「通向可信 Answer 的路径」，而不是替代 Answer。
- 纠错反馈闭环有价值（Querier 的提问改进数据源语义），但不能让 Querier 改动 Verified 上下文。纠错永远是给 Admin 复核的 Suggested 修改。

### Over-promise Check

PRD 明确不承诺：

- 任意自然语言查数。
- 跨连接 SQL join。
- 替代 BI、warehouse、ETL、DBA 工具或 SQL IDE。
- AI 自动理解或自动改变业务口径。
- 执行写操作或数据库管理操作。
- 回传用户自部署实例中的真实 schema、SQL、结果或 Playbook。

### UI Noise Check

以下概念不能成为 Querier 主界面元素：

- provider
- model
- adapter
- fixture
- session
- artifact
- raw tool payload
- debug trace
- review decision
- complex policy matrix

## Next Discussion Reminder

截至 v0.3，本 PRD 视为开发就绪:可作为 tech spec 阶段的基准。剩余工作进入实现规划,而非继续产品定义。

进入 tech spec 阶段时,优先:

1. 搭起独立的 `product-next` repo,把这套 PRD 移植为权威产品参照。
2. tech spec 从 **M0**(Sample 数据源可信闭环)开始——它在无真实库依赖下给 Answer Contract 去风险。
3. 把 Answer Contract(含 Status × Confidence 矩阵与 Unblock Path)落成具体 schema,并写成 M0 冒烟测试断言。
4. 钉死仍待定的实现输入:PostgreSQL-first adapter、first-run bootstrap、metadata store、凭证加密、provider 配置、默认 Policy 阈值。D1(跨连接对比)与 D4(Evidence 脱敏)已在上文给出产品决策——只剩实现机制留给 tech spec。
