# Planners Method Wiki

[![License: AGPL-3.0-only](https://img.shields.io/badge/license-AGPL--3--0--only-2563eb)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-339933)](https://nodejs.org)

**一套按 Karpathy LLM Wiki 模式组织的 Markdown 策略方法库——自带 11 个业务模块、33 个基础分析方法、22 个变体与可一键生成的单文件离线阅读页 `wiki-viewer.html`。**

> 作者：阿祖不看 TVC（小红书同名）· [demyth.info](https://demyth.info) · [Lawyif@163.com](mailto:Lawyif@163.com)

---

## 核心结构（Karpathy LLM Wiki）

方法库告别了难读难改的 JSON Schema，改为人机共读的纯 Markdown 真源（`base-wiki/`）：

```text
base-wiki/
├── SCHEMA.md          ← 方法页结构规范与 Query / Ingest / Lint 操作协议
├── index.md           ← 总目录与 11 个模块导航
├── log.md             ← 追加式维护日志
├── wiki-viewer.html   ← 由 build-wiki-viewer.mjs 生成的单文件离线阅读页
└── lenses/            ← 一方法一页（<lens_id>.md，含问题、操作步骤与页面表达结构）
```

> 铁律：Wiki 只沉淀**分析视角、操作步骤与页面表达结构**，绝不代替当前项目的真实数据与商业裁决。

---

## 三个 CLI 工具

```bash
# 1. 按关键词或模块检索方法
node scripts/query-wiki.mjs --query "价格战 非价格价值" --text

# 2. 校验 Wiki 结构、必填章节与 index/lenses 双向链接完整性
node scripts/lint-wiki.mjs --text

# 3. 编译单文件离线阅读页（base-wiki/wiki-viewer.html）
node scripts/build-wiki-viewer.mjs
```

---

## 在生态里的位置

- **独立使用**：随时查策略方法、补充新结案沉淀、构建与分享团队离线版方法阅读页。
- **被 [Planners Proposal](https://github.com/thePlannerIvan/Planners-Proposal-System) 调用**：发散与校验策略判断角度，辅助收敛 `storyline.md`。
- **被 [Planners Bypage](https://github.com/thePlannerIvan/planners-bypage) 调用**：读取方法里的 `## 页面表达结构`，指导每一页先讲什么、需要什么证据。
- **被 [Video Idea System](https://github.com/thePlannerIvan/video-idea-system) 调用**：通过 `query-wiki.mjs` 调取营销分析框架。

---

## 本地测试

```bash
npm test
```

Running `npm test` runs `node evals/run-all.mjs`, verifying `lint-wiki.mjs`, `query-wiki.mjs`, and `build-wiki-viewer.mjs`.
