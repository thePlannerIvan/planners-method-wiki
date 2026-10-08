# Planners Method Wiki

可复用的策略分析与论证方法库。Lens 解决一个问题，Recipe 组织方法之间的推导依赖，Module 提供分类。方法帮助理解与表达，项目事实和决定仍归项目本身。

由阿祖不看 TVC 创建与维护。网站：demyth.info；邮箱：Lawyif@163.com。

## 使用

查询或应用方法时读取 [SKILL.md](SKILL.md)。从方案资料提取方法、增补或修订库时，再读取 [维护流程](references/maintenance.md)。工具命令与输入输出见 [工具接口](references/tools.md)。

Proposal、Bypage 和 PPT Hell 沿用同一份项目记忆中的方法采用记录；Wiki 查询不另建项目来源索引、不代替事实核查、不重开主线审批。

```bash
node scripts/query-wiki.mjs --query "消费者 选择" --type lens --limit 5
node scripts/query-wiki.mjs --query "推导 比较" --type recipe --limit 5
node evals/run-all.mjs
```

## 方法库维护

```text
读取与定位材料 → 提取与整理方法 → 对照已有库 → 人工审阅变更 → 安装与验证
```

`change-set.json` 是唯一可编辑提案；审阅包是只读投影，批准绑定实际内容。安装器校验目标基线、来源、批准和引用图，支持无写入预检、批准子集、重复执行识别及失败恢复，不依赖旧 B1–B6 阶段状态。

默认 `base-wiki/` 是随 Skill 发布的只读资产。向用户指定库收录方法不会自动发布 Skill；升级基础库时才执行 Skill 源目录的完整发布流程。客户原始资料不默认进入公开资产。

## 依赖与验证

依赖 `planners-source-index` 的来源契约与唯一校验器，以及 `planners-review-core` 的审阅桥和宿主。按当前环境解析依赖；缺失时如实处理。`PLANNERS_NO_AUTO_INSTALL=1` 用于离线验证。

测试覆盖查询、来源、完整对象审阅、安装和内容交接；测试提交仅是夹具，不代表真实用户批准。效用需另外使用真实问题检验，格式与接口通过不等于方法已经证明有效。

本项目从 Planners Proposal System 的方法库组件拆出，保留原始署名与 AGPL-3.0-only 许可证。见 [LICENSE](LICENSE)、[NOTICE](NOTICE) 和 [TRADEMARK.md](TRADEMARK.md)。
