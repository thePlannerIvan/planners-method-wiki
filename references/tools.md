# 工具接口

`<Skill>` 为本 Skill 目录，`<Run>` 为维护工作目录。查询只需本文件的「查询」；维护按当前动作读取对应小节。每个入口提供 `--help`。

## 查询

```bash
node "<Skill>/scripts/query-wiki.mjs" --wiki-dir "<Wiki>" --query "<问题关键词>" --type lens --limit 5
node "<Skill>/scripts/query-wiki.mjs" --wiki-dir "<Wiki>" --query "<推导关键词>" --type recipe --limit 5
```

`--type` 支持 `lens`、`recipe`、`all`，默认 `lens`。结果给出库路径与内容指纹、对象 ID、匹配字段、完整对象、源文件位置、状态与审批信息；Recipe 同时提供成员 Lens 的定位。阅读全文可以直接打开 `source_path` 指向的 JSON 文件，以 ID 找到对应对象。

关键词分数是字符串匹配程度，不表示适用性或语义置信度。整句零结果时改用方法名称、输入输出或判断关系的关键词，或浏览相关 Module。正常零结果为 `ok=true` 和空数组；文件缺失、非法 JSON、索引或路径异常为 `ok=false` 和具体错误。

有效的历史对象保留原审批值，模块批准与对象批准分开报告；不补写对象级批准。废弃、删除与状态冲突对象不进入默认候选。Module 内旧 Recipe 只作为历史记录保留并警告，查询以 `wiki-recipes.json` 为权威，缺少真实步骤与依赖的记录不自动升级成可用 Recipe。

## 材料准备与来源

需要按页副本时使用 `prepare-paged-markdown.mjs`，保留已有换页边界；没有分页时按文本片段登记，不虚构原页码。需要把跨页单元物化成原文时使用 `materialize-semantic-units.mjs`，输入格式见 `contracts/semantic-unit-plan.schema.json`。已有可靠正文定位时可以不调用这两个工具。

```bash
node "<Skill>/scripts/prepare-paged-markdown.mjs" --text-root "<分页 Markdown 目录>" --corpus-id "<资料批次 ID>" --output-dir "<Run>/reading"
node "<Skill>/scripts/materialize-semantic-units.mjs" --plans "<Run>/plans.jsonl" --page-manifest "<Run>/reading/page-manifest.jsonl" --text-root "<分页 Markdown 目录>" --output-dir "<Run>/reading-units"
node "<SourceIndex>/scripts/validate-source-index.mjs" "<Index>"
```

`<SourceIndex>` 按名称解析为 `planners-source-index`。其契约与唯一校验器不代替实际阅读。提案中的来源 ID 映射同时绑定原文位置；被采用的来源文件和读取层需实际可读且与登记哈希一致。

## 快照与提案

```bash
node "<Skill>/scripts/build-wiki-snapshot.mjs" --wiki-dir "<Wiki>" --output "<Run>/wiki-snapshot.json"
node "<Skill>/scripts/validate-change-set.mjs" --input "<Run>/change-set.json" --source-index "<Index>"
```

增补时保存只读快照，使用返回的库指纹作为审阅基线。查询不要求保存快照。新建库的基线为 `null`，目标应不存在或为空。

提案格式见 `contracts/change-set.schema.json`；方法正文直接使用 `wiki-module.schema.json` 的 Lens 与 `wiki-recipe-catalog.schema.json` 的 Recipe 字段。`sources` 把每个新来源实例 ID 映射到原索引的 `source_id` 与 `locator`；旧库已有来源 ID 可以保留，新证据仍要有本轮映射。既有 Module 沿用定义，`modules` 只需提供新 Module 元数据。

校验器检查结构、来源、目标、ID 和依赖，不根据自报质量字段证明抽象有效。无候选是正常终态，不生成空审阅页。

## 审阅

```bash
node "<Skill>/scripts/start-library-review.mjs" --change-set "<Run>/change-set.json" --review-dir "<Run>/review"
node "<Skill>/scripts/review-inbox.mjs" --surface "<Run>/review/review-surface.json"
node "<Skill>/scripts/validate-review-feedback.mjs" --feedback "<Run>/review/review-feedback.json" --bundle "<Run>/review/review-bundle.json"
```

启动入口内部生成审阅包与页面，并交给 `planners-review-core`。宿主有 `review_open` 时加 `--surface-only`，把回执中的 surface 交给宿主打开；否则使用公共本地宿主。检查实际打开状态与返回 URL。审阅目录统一保存 bundle、页面、surface 和反馈。

用户返回后先收件。无提交时等待；仅整体意见时读取收据并返修，不能读取遗留批准继续安装。逐项反馈才进入反馈校验；内容返修重出审阅包，旧批准不能继续用。Recipe 校验实际需要的依赖，既有有效 Lens 可以直接引用。

## 安装与结果

```bash
node "<Skill>/scripts/install-wiki-module.mjs" --bundle "<Run>/review/review-bundle.json" --feedback "<Run>/review/review-feedback.json" --wiki-dir "<Wiki>" --report-output "<Run>/install-report.json" --dry-run
node "<Skill>/scripts/install-wiki-module.mjs" --bundle "<Run>/review/review-bundle.json" --feedback "<Run>/review/review-feedback.json" --wiki-dir "<Wiki>" --report-output "<Run>/install-report.json"
node "<Skill>/scripts/validate-install-report.mjs" "<Run>/install-report.json"
node "<Skill>/scripts/validate-utility-test.mjs" "<Run>/utility-test.json"
```

`--dry-run` 不写文件、目录或报告，也不消费批准。正式安装再次检查目标基线和来源。批准指纹用于识别重复执行，安装失败恢复本次已覆盖文件；机械事务锁只防同时写库，不要求模型提交阶段回执。

默认要求本轮完整逐项处置。用户明确要求先安装已批准部分时，在预检和正式安装都加 `--approved-only`；检查获批子集依赖闭合，其余内容保留在原提案。报告输出位于目标库外的维护工作区。

效用结果按 `contracts/utility-test.schema.json` 记录已测试或待输入；测试提供真实输入、方法引起的变化与风险，不由工具补写效果结论。
