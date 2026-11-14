# Planners Method Wiki

[![License: AGPL-3.0-only](https://img.shields.io/badge/license-AGPL--3.0--only-2563eb)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-339933)](https://nodejs.org)

**一套随装随查、也能持续往里攒经验的营销与策略方法库——自带 11 大业务方法模块，还支持把团队的实战方案沉淀成可审批、可检索的长期资产。**

> 作者：阿祖不看 TVC（小红书同名）· [demyth.info](https://demyth.info) · [Lawyif@163.com](mailto:Lawyif@163.com)
> *(从 [Planners Proposal System](https://github.com/thePlannerIvan/Planners-Proposal-System) 的方法组件独立拆出)*

---

## 一句话看懂：它能帮你做什么

写策略方案或 PPT 时最怕两件事：要么每次从白纸重新憋思考框架，要么把过去公司沉淀的方法论遗忘在网盘文件夹里。

**Planners Method Wiki** 把方法拆成三个简单零件帮你随时调取、也能随时往里加新货：

- **Lens（分析视角）**：单点切入问题（例如“怎么从价格战里拆出非价格价值”、“怎么诊断达人种草断裂点”）；
- **Recipe（推导配方）**：把几个 Lens 串成多步推演链；
- **Module（领域目录）**：按策略业务模块分组管理。

*(铁律：Wiki 只提供“思考和论证的方法”，不能代替你当下项目的真实数据与商业决定。)*

**所属生态位**：既可以**单独当作随身策略智库**检索问答或整理团队方法库，也可以在跑 [Planners Proposal System](https://github.com/thePlannerIvan/Planners-Proposal-System)、[Planners Bypage](https://github.com/thePlannerIvan/planners-bypage) 和 [Planners PPT Hell](https://github.com/thePlannerIvan/planners-ppt-hell) 时在背后自动按需调取。

---

## 开箱自带哪些策略方法？（`base-wiki/` 11 个内置模块）

安装后开箱即附带可读的策略基础库，涵盖策略策划全链路：

| 模块方向 | 涵盖典型场景 |
| --- | --- |
| 市场与品类 (`market-category`) | 品类边界判断、机会空间识别、成熟度分层 |
| 消费者洞察 (`consumer-insight`) | 动机挖深、态度与行为落差、非预设需求发现 |
| 竞品分析 (`competitor-analysis`) | 对手策略拆解、心智占领与差异化空位 |
| 产品价值 (`product-value`) | 卖点结构化翻译、功能到情绪价值的梯子 |
| 品牌策略 (`brand-strategy`) | 定位取舍、品牌角色、心智资产护城河 |
| 营销战役路径 (`campaign-journey`) | 认知→兴趣→转化→复购关键触点与节奏编排 |
| 内容执行 (`content-execution`) | 核心 Big Idea 落地内容矩阵、传播抓手 |
| 达人 / KOL 营销 (`creator-kol`) | 达人分层分工、种草内容角色与扩散机制 |
| 媒介与 SEM (`media-sem`) | 流量结构配置、搜索意图拦截与声量配比 |
| 执行规划 (`execution-planning`) | 资源分配、预算切块与阶段里程碑设计 |
| 效果度量 (`measurement`) | 指标拆解、归因口径与阶段检验标准 |

### 还能做什么：把自己的旧方案变成新方法

拿几份过去做过的优秀结案/方法论文档进来，它可以自动帮你：
1. 拆解出值得复用的新 Lens 或 Recipe（去客户专有名词抽象成通用方法）；
2. 生成一份可视化审阅页，**由你亲眼比对已有方法库、点选批准/合并/拒绝**；
3. 核验来源与引用后正式写入你的私人方法库目录（默认只读的自带 `base-wiki/` 不会被覆盖）。

---

## 什么时候选我 vs 选别的 Skill

| 你的需求 | 用哪个 Skill | 分工 |
| --- | --- | --- |
| 想找某个分析视角/框架来拆解问题，或把公司老方案沉淀成方法库 | **本 Skill (`planners-method-wiki`)** | 提供成熟方法检索、推导配方与可审阅的方法库维护 |
| 拿着具体 Brief 和资料做一份完整商业提案主线 | [`Planners-Proposal-System`](https://github.com/thePlannerIvan/Planners-Proposal-System) | 做策略取舍与 Storyline 主线；过程中遇到推理卡点时会自动来查我 |
| 需要一套从 0 梳理任意陌生专业术语表与 360px 思维导图 | [`keywords`](https://github.com/thePlannerIvan/keywords) | `keywords` 用来跨入新行业建全景术语导图；`method-wiki` 专攻可执行的策略分析套路 |

---

## 快速开始与安装

### 1. Codex / Claude Code 用户

```bash
npx skills add https://github.com/thePlannerIvan/planners-method-wiki --skill planners-method-wiki
```

或克隆到本地 Skill 目录：

```bash
git clone https://github.com/thePlannerIvan/planners-method-wiki.git ~/.codex/skills/planners-method-wiki
# 或
git clone https://github.com/thePlannerIvan/planners-method-wiki.git ~/.claude/skills/planners-method-wiki
```

DSH 用户若通过 [Planners Form](https://github.com/thePlannerIvan/planners-form) 安装了 `planners-proposal-system` 或 `planners-bypage`，本方法库通常会一并就绪。

### 2. 直接这样用

**找方法启发思考：**

```text
用 $planners-method-wiki 查一下：当新品价格比竞品高 30% 时，怎么论证价值溢价而不落入比参数？给我推荐匹配的 Lens 和推演步骤。
```

**沉淀方法入库：**

```text
我这有两份过去的达人种草复盘资料，用 $planners-method-wiki 帮我提炼成可复用的方法卡片，打开审阅页让我确认后再收录到 ./my-team-wiki。
```

### 运行时依赖（缺了会自动处理）

- **环境要求**：Node.js 20+。
- **自动按需加载的公共模组**（首次运行缺项时会自动拉取至 `~/.planners-modules/`）：
  - [`planners-source-index`](https://github.com/thePlannerIvan/planners-source-index) —— 从资料抽提方法时的来源追溯
  - [`planners-review-core`](https://github.com/thePlannerIvan/planners-review-core) —— 维护增补方法时的可视化对比审阅页宿主

---

<details>
<summary>开发者说明：CLI 查询、维护流水线与回归测试</summary>

### 常用查询与验证命令

```bash
node scripts/query-wiki.mjs --query "消费者 选择" --type lens --limit 5
node scripts/query-wiki.mjs --query "推导 比较" --type recipe --limit 5
node evals/run-all.mjs
```

### 维护流程与接口

完整增补/修订流程见 [`references/maintenance.md`](references/maintenance.md)，工具接口与返回格式见 [`references/tools.md`](references/tools.md)：
- 所有待入库修改先汇总至可编辑 `change-set.json`，审阅面为只读对比视图，批准绑定真实内容；
- 支持离线预检与部分批准；客户项目原始数据默认不进内置 `base-wiki/`。
- 设置 `PLANNERS_NO_AUTO_INSTALL=1` 可禁止缺模组时自动拉取，用于离线或 CI 审查。

</details>

---

## 品牌边界、开源协议与商业合作

- **许可协议**：以 [AGPL-3.0-only](LICENSE) 发布，可商业使用；修改版及对外网络服务须公开对应源码。
- **归属与商标**：请保留 [NOTICE](NOTICE) 中的署名与出处；基于本仓库的衍生或修改版须标注 fork，详见 [TRADEMARK.md](TRADEMARK.md)。
- **商业支持**：企业专属方法库定制搭建、内部知识库私有化部署或闭源授权，请联系 `Lawyif@163.com` 或访问 [demyth.info](https://demyth.info)，详见 [COMMERCIAL.md](COMMERCIAL.md)。

## 相关项目

- [Planners Proposal System](https://github.com/thePlannerIvan/Planners-Proposal-System) —— 策略共创与 Storyline 主线工作台
- [Planners Bypage](https://github.com/thePlannerIvan/planners-bypage) —— 多源资料 → 逐页 PPT 文案
- [Planners PPT Hell](https://github.com/thePlannerIvan/planners-ppt-hell) —— 可编辑 PPT 与视频静态画面制作
