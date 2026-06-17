# AI 数据门户 — PRD 梳理与评审

> 基于 `prd.en.md` / `roadmap.en.md` / `glossary.en.md`(已更新至 **v0.2**,2026-06-17)整理。
> 上半部分是**精炼总结**,帮助快速对齐;下半部分是**批判性评审**,指出矛盾、风险与待决问题。
>
> **v0.2 变化**:产品交互模型升级为「会话优先」(参考 Claude Desktop 这类 AI 时代工具),新增 `Interaction Model` 一节(Investigation Thread、Answer 作为持久 artifact、流式推理、追问 vs 新建排查、纠错反馈闭环、快捷操作/命令入口),并新增 Status × Confidence 合法矩阵。可评审原型见 `prototypes/prototype.html`。
>
> **v0.3 变化(开发就绪)**:补齐进入 tech spec 所需的四块——`Success Measurement and Validation Signals`(护栏/价值/反向信号 + 决策规则)、`Roles and Capability Matrix`、`Application States and Errors`、`Implementation Milestones`(M0/M1/M2),外加无障碍基线;并为 D1(跨连接对比范围)与 D4(Evidence 脱敏)写入了「备选方案 + 推荐决策」两节,只把实现机制留给 tech spec。**至此本 PRD 的全部产品级开放问题均已收敛,可作为 tech spec 基准。** `product-next` 为独立产品,将开独立 repo,不继承父目录 `docs/`。

---

## 一、一句话理解

> 一个**自托管的 AI 数据门户**:小团队把内部数据库包装成「受控数据源」,成员用自然语言提问,后端做安全校验、只读执行、脱敏,产出**带证据、可追溯**的可信答案——无需把数据库凭证发给每个人,也无需人人会写 SQL。

它**不是**:AI 版 DBeaver(SQL IDE)、轻量 BI、数据仓库/ETL、公有 SaaS。

---

## 二、要解决的核心痛点

1. **对象级排查难快速启动** — 技术支持/工程师常要查某个客户、账单、订单,但不知道哪个数据源/表/字段是权威的。
2. **SQL 客户端的工作流难交接** — 写 SQL、截图、复制结果给业务同事,参数、过滤、假设、注意事项无法复用或复核。
3. **数据访问与数据需求错配** — 业务/运营/产品需要答案,但不该拿到数据库凭证;团队需要一个只读、授权、脱敏、限成本的提问入口。
4. **AI 生成 SQL ≠ 可信答案** — 没有业务语义、策略、安全校验、受控执行和证据,答案不可信、不可交接。
5. **业务定义与排查经验沉淀差** — 状态含义、软删除规则、退款字段、时间语义、跨库 ID 等都在某些人脑子里。

---

## 三、目标用户(V1 优先级)

| 优先级 | 角色 | 关注点 |
|---|---|---|
| **主要设计对象** | 技术型数据请求处理者(产品/全栈/支持工程师、技术运营) | 懂业务系统、有一定数据库基础,但不想每次手写 SQL 或分发凭证 |
| **核心配置者** | 数据源 Owner / Admin | 把业务系统包装成可用数据源:建连接、校准语义、配策略、邀请成员 |
| **支持但非主要** | 业务/运营/产品同事(作为 Querier) | 使用已发布的数据源提问;V1 不为纯非技术用户做专门优化 |
| **次要** | DBA/平台工程师、工程经理 | 连接安全、只读、可审计、查询成本;答案可复核、知识沉淀 |

---

## 四、九条产品原则(精简)

1. **先提问,需要时再检查** — 从问题出发,不从 schema 树/SQL 编辑器出发;SQL 始终可查但不阻断。
2. **数据源高于连接** — 用户对着数据源提问,连接是底层技术资源,不进用户心智模型。
3. **AI 提议,应用控制** — AI 出计划和 SQL,应用负责校验、授权、执行、脱敏、记录、产证据。
4. **业务语义需验证而非假定** — AI 可出草稿,需 Admin 确认才算可靠上下文(Suggested → Verified)。
5. **每个答案都要有证据** — 查了什么、怎么得出结论、还有什么假设/不确定。
6. **从排查起步,长成洞察** — V1 聚焦对象排查;报表/监控由重复排查与 Playbook 自然生长。
7. **产品表面保持简单** — provider/session/fixture/debug/artifact 等工程概念不进主流程。
8. **自托管信任边界** — schema、SQL、结果、定义、排查、Playbook 默认留在自托管部署内。
9. **双语 + 明暗主题首发** — UI 支持中英文 × 明暗;代码/注释/测试/提交信息保持英文。

---

## 五、黄金路径(Golden Path)

```
Admin 侧                                          Querier 侧
─────────────────────────────────────            ──────────────────────────────
1. 创建数据源(如「广告平台」)
2. 挂接一个/多个连接并测试连通性
3. 系统自省 schema → Schema Snapshot
4. AI 起草数据源上下文                              7. 选数据源,用自然语言提问
   (概览/核心实体/字段/关系/敏感字段/示例问题)        「ACME 这月广告账单为何高于上月?」
5. Admin 校验语义 + 配置 Policy                    8. Agent 跑受控排查(低风险只读自动跑;
   (只读/行数上限/敏感字段/自动执行/确认规则)            高风险/不确定/越权则确认或拒绝)
6. 发布数据源(Draft → Published)                  9. 返回带证据的 Answer
                                                  10. Investigation 存档,供复核/交接/Playbook
```

---

## 六、领域模型(核心对象关系)

```
Team (每部署默认 1 个,几乎不进 UI)
 ├── User                       账户;无全局固定角色,按资源授权
 ├── Connection                 团队级技术资源(库地址+凭证),角色:Owner/Admin
 │     └── Schema Snapshot      后端自省的结构元数据(AI 只读快照,不直连库)
 └── Data Source ★核心对象       业务系统的提问入口,角色:Owner/Admin/Querier
       ├── Data Source Connection  引用连接 + 别名/用途/表字段范围/敏感处理
       ├── Data Source Context     概览/边界/适合与不适合的问题/业务说明
       ├── Business Glossary       业务术语与指标(Suggested → Verified)
       ├── Entity Mapping          业务实体↔库结构映射(需验证才算强证据)
       ├── Policy                  只读/自动执行/确认/行数/范围/脱敏/超时/留存
       └── Investigation           Question→计划→Query Run→Evidence→Answer(可多版本)
```

关键规则:**复用连接 ≠ 间接拿到数据库入口**;同一连接被多个数据源引用时,各自可定义不同的表/字段范围、语义与策略;Querier 永远不直接管理连接。

---

## 七、Answer 契约(产品的核心交付物)

Answer 不是聊天回复,也不是完整 BI 报告。它必须回答三件事:**结论是什么?有什么数据支撑?我该多信它?**

必备字段:

1. **Status** — Answered / Partial / Needs Clarification / Blocked by Policy / No Reliable Answer
2. **Direct Answer** — 一句话直接回答
3. **Confidence** — High / Medium / Low / Cannot Determine(**必须给原因**)
4. **What I Did** — 排查路径(可折叠,但须持久保存)
5. **Key Findings** — 每条至少引用一个 Evidence(无证据不得作为事实结论)
6. **Evidence** — 目的/数据源/连接/表/Query Run/结果摘要/SQL(默认折叠)/执行元数据/策略说明
7. **Assumptions & Definitions** — 时间窗/过滤/指标定义/状态枚举/连接键/所用 Verified 条目
8. **Caveats / Uncertainty** — 数据缺口、未验证映射、跨连接限制、截断/脱敏、需人工确认处
9. **Charts** — 可选,引用证据;V1 仅自动生成表/柱/线/简单对比,无图表编辑器
10. **Recommended Follow-ups** — 2-3 个后续问题
11. **Version Metadata** — 版本、创建时间、基于哪次澄清/追问、最新标记

**AI 何时不该直接给答案**(应澄清/拒绝/返回不可靠):业务对象不清、缺关键时间范围、需越权表字段、需变更操作、多种定义会导致不同答案、跨连接关系无验证映射、结果不足以支撑结论。

---

## 八、架构信任边界(产品级,非技术设计)

- **AI 执行边界** — AI 不直连库、不持凭证、不执行 SQL,只产出计划/SQL 草稿/工具调用请求。
- **V1 运行时** — Backend Direct Connection:自托管后端用连接凭证在团队自有环境执行**只读**查询。
- **SQL Safety Gate** — 所有 SQL 执行前过确定性安全检查(是否只读/允许的连接/允许的表字段/敏感字段/行数时窗超时/是否需确认/是否含变更或 DDL/管理命令)。**AI 不能覆盖 Gate 决策。**
- **结果脱敏与有限上下文** — 回传给 AI 前脱敏、截断、优先聚合/摘要/样本;不向模型发送凭证、密钥、越权字段或多余原始数据(默认假设 provider 是外部服务)。
- **证据记录器** — 每次 Query Run 记录足够的证据元数据,绑定到具体 Answer 版本。

---

## 九、V1 范围

**In Scope:** 自托管 Web App(单 Team)、用户与成员基础、连接管理、数据源生命周期(Draft→Published→Archived)、数据源校准(自省/快照/AI 草稿/术语表/实体映射/Suggested→Verified)、Policy 基础、Ask Data 流程、受控只读执行、Answer 契约、证据与 Query Run、Sample Data Source、双语+主题、基础 provider 配置。

**仅 Roadmap(保留接口/边界,不进 V1 主路径):** Playbook 编辑器与 AI 建议、报表/监控/告警、仪表盘构建器、复杂 IAM、多步审批、原生桌面应用、插件市场、Worker/Agent 运行时、联邦查询/跨连接 JOIN、公有多租户 SaaS。

**首发关键决策:** PostgreSQL 优先;本地账户 + 首次启动引导(首位完成设置者成为 Owner);provider 走环境变量/部署配置;连接凭证应用层加密;独立元数据存储;默认策略严格安全(只读/行数/超时/折叠 SQL/记录 Query Run);Answer 最新优先 + 轻量历史;图表先表格与简单对比;结果保留摘要、限制原始大结果。

---

## 十、导航与首屏

主导航只有两个入口:**Ask Data**(选数据源提问)与 **Data Sources**(Owner/Admin 配置管理)。

首次无真实数据源时,首屏先讲价值:一句定位、`Try Sample Data Source`(主按钮)、`Create Data Source`(次按钮)、2-3 个示例问题、简短安全说明。有可用数据源后,默认主页是 **Ask Data**。

不进 V1 主导航:Dashboard/Insights、Playbooks、Approvals、Audit Logs、Connections、Provider Settings、Debug、Sessions、Artifacts。

---

## 十一、交互模型(v0.2 新增,会话优先)

把产品从「表单 + 一问一答」升级为 **AI 时代的会话工具**,但仍受授权数据源、Safety Gate、Answer 契约约束(不退化成通用聊天机器人):

- **Investigation Thread** — 一等、可恢复的会话线程,绑定单个数据源,跨会话持久;历史列表是常驻主界面。
- **Composer** — 提问与追问的唯一入口,数据源选择器内嵌为胶囊;从 composer 提交在当前线程追加新回合,不替换旧答案。
- **流式推理** — 运行时分步展示,完成后折叠进 `What I Did`;永不暴露 provider/model/raw payload。
- **Answer 作为持久 artifact** — 带版本、固定在线程内,是被复核/交接/沉淀 Playbook 的单元;行内引用(Key Finding → `E1`)可跳到证据。
- **追问 vs 新建排查** — 同源 + 延续话题 ⇒ 追问(新版本);换源或换话题 ⇒ 新线程;含糊时 agent 先问。
- **澄清是对话回合** — `Needs Clarification` 给出可点选项,不是死胡同。
- **纠错反馈闭环** — Querier 对口径/映射的异议转为给 Admin 复核的 `Suggested` 修改,绝不静默改 Verified。
- **快捷操作 / 命令入口** — 答案上的重跑/交接/(roadmap)存为 Playbook;⌘K 等命令入口,轻量、不强制。

---

# 批判性评审

下面是我读完三份文档后认为**值得在进入实现规划前讨论**的矛盾、风险与开放问题。PRD 本身的 "Known Tensions" 已识别了一部分,我做了扩展和补充。

## A. 文档已识别的张力(我认同且补充)

1. **双重成员模型(Data Source Membership + Connection Membership)** — 提升了安全性(避免"复用连接=拿到库入口"),但对小团队是真实的认知负担。建议:V1 默认让 Data Source Admin 在"该连接已被授权"时一键复用,把双层授权的复杂度藏在高级设置里,而不是首次配置就暴露。
2. **数据源校准必须轻量** — PRD 反复强调"别让 Admin 觉得在做数据治理",但黄金路径第 4-6 步(AI 草稿→校验术语/映射→配 Policy)客观上步骤不少。**这是最大的产品风险**:校准体验若重,Admin 流失,Querier 永远等不到可用数据源。建议明确"最小可发布集"——能否做到"AI 起草 + Admin 只确认敏感字段和只读策略"即可发布?
3. **Provider 配置 vs 主流程纯净** — 一致,无异议。
4. **Answer 版本化** — 底层支持多版本但 UI 要轻,容易做成"假轻量真复杂"。✅ **v0.2 已解决**:追问 vs 新建排查规则已写入 `Interaction Model`(见 D2)。
5. **Sample 可执行但不加数据库依赖** — 技术实现待定,产品方向清晰。

## B. 范围与里程碑风险

1. **V1 范围偏大。** In Scope 有 13 项,几乎是一个完整产品。✅ **v0.3 已解决**:已拆成 `Implementation Milestones` M0(仅 Sample 跑通可信闭环)/ M1(真实 PG + 受控执行)/ M2(校准+发布+角色),按产品风险从高到低排序,各自可独立演示。
2. **Answer 契约是最该先验证、也最该被当成冒烟测试目标的东西。** ✅ **v0.3 已对齐**:M0 即以 Answer 契约(含 Status × Confidence 矩阵与 Unblock Path)为冒烟测试主干。落 schema + 断言是 tech spec 第一步。

## C. 体验上的潜在矛盾

1. **"先提问"原则 vs 强校准前置。** Querier 的理想是"打开就问",但一个高质量答案依赖 Admin 已完成的语义校验。若校准没跟上,Querier 会频繁撞到 "Needs Clarification / No Reliable Answer",体验上像"AI 很笨"。✅ **v0.2 已部分解决**:`Interaction Model → Correction & Feedback Loop` 已把"Querier 异议 → 给 Admin 的 Suggested 修改"写入产品。仍待落地的是"答不了时主动提示缺哪条定义"的具体提示文案与触发时机。
2. **"AI 不发明确定性"是正确的,但拒答率过高会被当成产品没用。** ✅ **v0.2 已解决**:新增 `Interaction Model → Unblock Path`——每个非 `Answered` 状态必须点名「缺什么」并给出具体「下一步」(选口径/设时间范围/通知 Admin 验证映射/改用更窄问题),且「通知 Admin」复用纠错反馈闭环生成 Suggested 条目。Answer 契约、Decision Boundaries、Success Criteria #7 均已对应更新。原型里也做了一个跨库对账的受阻示例。

## D. 模型/定义上的待决问题(进实现规划前需拍板)

1. ✅ **v0.3 已解决:跨连接边界。** 新增 `Cross-Connection Comparison Scope (D1)`:V1 支持跨连接*对比*、不支持跨连接 *SQL*(每条 SQL 仍单连接,无 JOIN/虚拟表/强一致);需 Verified 映射为门槛,否则走 Unblock Path;结论必带时间/一致性 Caveat 且不得评 High。原型的跨库示例正是这一场景。只剩关联机制/上下文大小留给 tech spec。
2. ✅ **v0.2 已解决:追问 vs 新 Investigation 的边界。** 已写入 `Interaction Model → Follow-up vs New Investigation`:同源+延续话题=追问(新版本),换源/换话题=新线程,含糊时先问。
3. ✅ **v0.2 已解决:Confidence 与 Status 的关系。** Answer 契约里新增 Status × Confidence 合法矩阵(如 `Needs Clarification`/`Blocked by Policy` 只能 `Cannot Determine`)。
4. ✅ **v0.3 已解决:"谁能看 Evidence/SQL"。** 新增 `Evidence Redaction and Visibility (D4)`:脱敏延伸到 Evidence 展示层、沿用执行 Policy、按角色区分(Querier 看脱敏后、Admin/Owner 看更全、凭据对谁都不露),只剩遮蔽表示等机制留给 tech spec。

## E. UI 失败标准之间的内在拉扯

PRD 的 "UI Failure Criteria" 很好,但第 7 条(答案必须含 SQL/证据/定义/假设/不确定)与第 10 条(次要功能别抢焦点)、以及 10 秒理解原则之间存在张力:**Answer 信息量很大,容易把"读懂结论"这件事淹没。** 这正是原型要解决的核心设计问题——默认只露 Direct Answer + Confidence + Key Findings,其余(Evidence/SQL/Assumptions/Caveats)折叠分层。我在原型里就是这么做的。

## F. 建议的下一步

v0.2 解决了 A4 / C2 / D2 / D3 并部分解决 C1;**v0.3 解决了 B1 / B2 / D1 / D4**(里程碑、冒烟目标、跨连接范围、Evidence 脱敏),并补齐成功度量、角色矩阵、状态错误目录、无障碍。**至此所有产品级开放问题均已收敛。**

下一步直接进入 tech spec:开独立 repo、从 M0 起、把 Answer 契约(含 Status × Confidence 矩阵与 Unblock Path)落成 schema + 冒烟断言;D1/D4 只需实现其机制(关联方式、遮蔽表示、详情边界等)。
