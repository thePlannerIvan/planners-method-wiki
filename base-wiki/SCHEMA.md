# Planners Method Wiki · Schema (Karpathy LLM Wiki)

本文件规定策略方法库（`<wiki_dir>/`）的文件结构、Markdown 方法页格式与日常维护规则。

## 目录结构

```text
<wiki_dir>/
├── SCHEMA.md          ← 本文件（格式与操作规则）
├── index.md           ← 总目录与模块概览（11 个模块，所有 Lens 的导航入口）
├── log.md             ← 追加式维护日志（每次增补 / 修订追加一条）
├── wiki-viewer.html   ← 由 build-wiki-viewer.mjs 编译生成的单文件离线阅读页
└── lenses/            ← 方法页目录（一方法一页，<lens_id>.md）
```

## 方法页格式（`lenses/<lens_id>.md`）

每份方法页由 YAML frontmatter + 7 个固定二级标题组成：

```markdown
---
id: lens_xxx
name: 方法名称
aliases: ["别名1"]
module_id: mod_brand-strategy
module_title: 品牌策略开发
status: draft | approved
updated: YYYY-MM-DD
source_instances: ["来源或案例标识"]
---

# 方法名称

## 解决的问题

用一两句话说明该方法回答什么策略或论证问题。

## 适用与跳过条件

### 适用条件
- 满足什么前提时采用

### 跳过条件
- 什么情况下跳过

## 所需输入

- 执行该方法需要哪些项目材料或前置输出

## 分析操作步骤

1. 第一步做什么、作什么判断、如何影响下一步
2. 第二步...

## 页面表达结构

### P1 · 页面标题方向

这一页怎么组织信息、回答什么问题、需要什么证据。

- **论证目的**：...
- **回答问题**：...
- **所需证据**：...

## 输出与失效边界

### 预期输出
- 产出什么判断或框架

### 失效模式
- 常见错误用法

### 适用边界
- 方法不覆盖的范围

## 案例证据与变体

### 案例证据
说明该方法从哪些实战案例提炼而来（已去项目化）。

### 变体
（没有变体时写「（暂无）」；有变体时用 `#### 变体名称 (\`variant_id\`)` 列出适用条件与操作步骤）
```

## 去项目化与证据边界

1. **只存方法，不存项目答案**：品牌名、具体预算、当期策略结论留在项目 `source-index.json` 与案例原文；方法页中只保留通用变量、判断条件与页面表达结构。
2. **页面表达结构必填**：每条方法都必须说清 `## 页面表达结构`，帮助下游（Proposal / Bypage）知道该如何排布页面论证。
3. **先建草稿，审阅转正**：新提炼的方法 `status` 默认写 `draft`，经人工通过 `wiki-viewer.html` 或文本工作台确认后再改为 `approved`。

## 日常操作（Query / Ingest / Lint）

1. **查询（Query）**：先读 `index.md`（或运行 `node scripts/query-wiki.mjs --query "..."`），再 `read_file` 打开命中的 `lenses/<id>.md` 全文。
2. **沉淀（Ingest）**：读 `SCHEMA.md`、`index.md` 与 `log.md` 尾部 → 判断归属新方法或修订现有方法 → 写入/更新 `lenses/<id>.md` → 更新 `index.md` → 追加 `log.md` → 运行 `lint-wiki.mjs` 与 `build-wiki-viewer.mjs`。
3. **校验（Lint）**：`node scripts/lint-wiki.mjs --wiki-dir <wiki_dir> --text` 检查 frontmatter、7 个必填段落、`index.md` 与 `lenses/*.md` 双向对齐，零错误、零孤儿页、零断链。
