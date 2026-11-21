#!/usr/bin/env node
/**
 * 将 Karpathy LLM Wiki Markdown 方法库编译成单文件离线可检索阅读页（wiki-viewer.html）。
 * 用法：node scripts/build-wiki-viewer.mjs [--wiki-dir <Wiki>] [--output <wiki-viewer.html>]
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadWiki } from './lib/wiki-markdown.mjs';

const HERE = resolve(import.meta.dirname, '..');
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ESC[c]);
const pad2 = (n) => String(n).padStart(2, '0');

const plainList = (items) => (items?.length ? `<ul>${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '');
const stepList = (items) => (items?.length ? `<ol class="steps">${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>` : '');
const field = (label, en, html) => (html ? `<div class="field"><div class="field-label">${esc(en)}<span class="zh">${esc(label)}</span></div><div class="field-val">${html}</div></div>` : '');

function renderVariants(lens) {
  const parts = [];
  for (const v of lens.variants || []) {
    const use = v.use_conditions?.length ? `<div class="sublabel">适用条件</div>${plainList(v.use_conditions)}` : '';
    const ops = v.analysis_operations?.length ? `<div class="sublabel">操作步骤</div>${stepList(v.analysis_operations)}` : '';
    parts.push(`<div class="variant"><p class="variant-name">${esc(v.name)}</p>${use}${ops}</div>`);
  }
  for (const r of lens.historical_recipes || []) {
    parts.push(`<div class="variant"><p class="variant-name">历史推导记录：${esc(r.name)}</p><p class="note">${esc(r.recipe_id)}</p></div>`);
  }
  if (!parts.length) return '';
  return `<div class="field"><div class="field-label">Variant<span class="zh">变体与参考</span></div><div class="field-val"><div class="variants">${parts.join('')}</div></div></div>`;
}

function renderLens(lens, order) {
  const searchText = [
    lens.name, lens.question, ...lens.aliases, ...lens.use_conditions, ...lens.skip_conditions,
    ...lens.required_inputs, ...lens.analysis_operations, ...lens.output_types, ...lens.failure_modes,
    ...lens.boundaries, lens.evidence, ...lens.page_structure.map((p) => `${p.title} ${p.content}`),
    ...lens.variants.map((v) => `${v.name} ${v.analysis_operations.join(' ')}`), lens.lens_id,
  ].join(' \n ').toLowerCase();

  const flags = [];
  flags.push(`<span class="flag ${lens.status === 'approved' ? '' : 'flag-accent'}">${esc(lens.status === 'approved' ? '已确认' : '草稿')}</span>`);
  if (lens.variants.length) flags.push(`<span class="flag flag-accent">变体 ${lens.variants.length}</span>`);
  if (lens.analysis_operations.length) flags.push(`<span class="flag">${lens.analysis_operations.length} 步</span>`);
  if (lens.page_structure.length) flags.push(`<span class="flag flag-accent">${lens.page_structure.length} 页表达</span>`);

  const pageStructure = lens.page_structure.length
    ? `<ul>${lens.page_structure.map((p) => `<li><b>P${p.page} · ${esc(p.title)}</b><br><span class="note">${esc(p.content)}</span></li>`).join('')}</ul>`
    : '<p class="muted">暂无页面表达结构（可按操作步骤推导）。</p>';

  const evidence = lens.evidence ? `<p>${esc(lens.evidence)}</p>` : '<p class="muted">未附案例证据说明。</p>';

  return `
        <article class="lens" id="${esc(lens.lens_id)}" data-search="${esc(searchText)}" data-name="${esc(lens.name)}" data-q="${esc(lens.question)}">
          <button class="lens-head" type="button" aria-expanded="false" aria-controls="${esc(lens.lens_id)}-body">
            <span class="lens-no">${pad2(order)}</span>
            <span class="lens-text">
              <span class="lens-name">${esc(lens.name)}</span>
              <span class="lens-q">${esc(lens.question)}</span>
              <span class="lens-flags">${flags.join('')}</span>
            </span>
            <span class="toggle-mark" aria-hidden="true"></span>
          </button>
          <div class="lens-body" id="${esc(lens.lens_id)}-body">
            <div class="lens-body-inner">
              <div class="lens-body-content">
                <div class="fields">
                  ${field('适用条件', 'Use when', plainList(lens.use_conditions))}
                  ${field('跳过条件', 'Skip when', plainList(lens.skip_conditions))}
                  ${field('所需输入', 'Inputs', plainList(lens.required_inputs))}
                  ${field('操作步骤', 'Operations', stepList(lens.analysis_operations))}
                  ${field('页面表达', 'Page structure', pageStructure)}
                  ${field('预期输出', 'Outputs', plainList(lens.output_types))}
                  ${field('失效模式', 'Failure modes', plainList(lens.failure_modes))}
                  ${field('适用边界', 'Boundaries', plainList(lens.boundaries))}
                  ${field('案例证据', 'Evidence', evidence)}
                  ${renderVariants(lens)}
                </div>
                <div class="idline">
                  <span>${esc(lens.lens_id)}</span>
                  <button class="copybtn" type="button" data-copy="${esc(lens.lens_id)}">复制 ID</button>
                  <span>${esc(lens.rel_path)} · 更新 ${esc(lens.updated || '—')}</span>
                </div>
              </div>
            </div>
          </div>
        </article>`;
}

export function buildWikiViewer({ wikiDir, outputPath } = {}) {
  const wiki = loadWiki(wikiDir);
  const out = resolve(outputPath || join(wiki.wikiDir, 'wiki-viewer.html'));
  const lensMap = new Map(wiki.lenses.map((l) => [l.rel_path, l]));

  const fingerprint = createHash('sha256')
    .update(wiki.index.raw)
    .update(wiki.lenses.map((l) => l.raw).join('\n'))
    .digest('hex');

  let order = 1;
  const sections = [];
  const nav = [];
  for (let i = 0; i < wiki.index.modules.length; i += 1) {
    const mod = wiki.index.modules[i];
    const modLenses = mod.lens_links.map((link) => lensMap.get(link.href)).filter(Boolean);
    const lensHtml = modLenses.map((lens) => renderLens(lens, order++)).join('');
    const preconds = mod.preconditions.length
      ? `<ul class="precond">${mod.preconditions.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>`
      : '';
    sections.push(`
      <section class="module" id="${esc(mod.module_id)}" style="--i:${i}">
        <header class="module-head">
          <div class="mod-no">M${pad2(i + 1)}</div>
          <div>
            <h2>${esc(mod.title)}</h2>
            <p class="mod-meta">
              <span><code>${esc(mod.module_id)}</code></span>
              <span>${modLenses.length} 个方法</span>
            </p>
            ${mod.decision ? `<p class="mod-decision">${esc(mod.decision)}</p>` : ''}
            ${preconds}
          </div>
        </header>
        <div class="lenslist">${lensHtml}</div>
      </section>`);
    nav.push(`<li><a class="navlink" href="#${esc(mod.module_id)}" data-target="${esc(mod.module_id)}">
        <span class="nav-no">M${pad2(i + 1)}</span>
        <span class="nav-title">${esc(mod.title)}</span>
        <span class="nav-count">${modLenses.length}</span>
      </a></li>`);
  }

  const totalVariants = wiki.lenses.reduce((n, l) => n + l.variants.length, 0);
  const withPageStruct = wiki.lenses.filter((l) => l.page_structure.length > 0).length;
  const approvedCount = wiki.lenses.filter((l) => l.status === 'approved').length;
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '.');
  const css = readFileSync(join(HERE, 'assets', 'viewer.css'), 'utf8');
  const js = readFileSync(join(HERE, 'assets', 'viewer.js'), 'utf8');

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>策略方法库 · Planners Method Wiki</title>
<meta name="description" content="Karpathy LLM Wiki 策略方法库：${wiki.index.modules.length} 个模块、${wiki.lenses.length} 个方法。">
<style>
${css}
</style>
</head>
<body>
  <header class="topbar">
    <div class="brand">
      <span class="brand-kicker">Method&nbsp;Wiki</span>
      <span class="brand-name">策略方法库</span>
    </div>
    <div class="search-wrap">
      <svg class="search-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="4.4" stroke="currentColor" stroke-width="1.3"/><path d="M10.4 10.4 14 14" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
      <input id="search" class="search" type="search" placeholder="搜索方法、判断问题、页面表达或步骤…" autocomplete="off" spellcheck="false" aria-label="搜索方法库">
      <span class="search-kbd">/</span>
      <span class="search-count"></span>
    </div>
    <div class="toolgroup">
      <button class="toolbtn" id="expand-all" type="button" aria-pressed="false">展开全部</button>
      <button class="toolbtn" id="collapse-all" type="button" aria-pressed="false">收起</button>
    </div>
  </header>

  <div class="shell">
    <aside class="rail">
      <p class="rail-title">目录 · ${wiki.index.modules.length} 模块</p>
      <p class="rail-stats">
        <b>${wiki.lenses.length}</b> 个方法 · <b>${totalVariants}</b> 个变体<br>
        已确认 ${approvedCount}/${wiki.lenses.length} · 含页表达 ${withPageStruct}<br>
        指纹 <span title="${esc(fingerprint)}">${esc(fingerprint.slice(0, 10))}</span>
      </p>
      <ul class="navlist">
        ${nav.join('')}
      </ul>
      <p class="rail-foot">
        <strong>Use</strong>
        Markdown 真源方法库：提供推导步骤与页面表达结构，项目事实与结论仍由项目材料决定。
      </p>
    </aside>

    <main class="main">
      <section class="masthead">
        <div class="masthead-ghost">WIKI</div>
        <p class="eyebrow">Planners Method Wiki · Markdown</p>
        <h1>可复用的策略判断与页面表达方法</h1>
        <p class="lede">
          每个条目是一篇独立维护的 Markdown 方法页：它说明自己解决什么问题、需要什么输入、按什么顺序推导、
          <em>页面该如何表达</em>以及在哪里失效。
        </p>
        <div class="stats">
          <div class="stat"><b>${wiki.index.modules.length}</b><span>Modules</span></div>
          <div class="stat"><b>${wiki.lenses.length}</b><span>Lenses</span></div>
          <div class="stat"><b>${totalVariants}</b><span>Variants</span></div>
          <div class="stat"><b>${withPageStruct}</b><span>Page Guides</span></div>
        </div>
      </section>

      ${sections.join('')}

      <div class="empty-state">
        <p>没有匹配 <b>「<span id="empty-query"></span>」</b> 的条目。</p>
        <p class="muted">试试方法名称、判断问题或输入输出的关键词，例如「定位」「预算」「消费者反馈」。</p>
      </div>

      <footer class="footer">
        <p>
          <strong>Planners Method Wiki</strong><br>
          Markdown 真源 · 页面生成 ${esc(today)} · 指纹 ${esc(fingerprint.slice(0, 16))}
        </p>
        <p>
          <strong>ORIGIN</strong><br>
          方法库由阿祖不看 TVC 创建与维护 · demyth.info<br>
          改动方法页（lenses/*.md）后重新运行 build-wiki-viewer.mjs 即可更新。
        </p>
      </footer>
    </main>
  </div>

<script>
${js}
</script>
</body>
</html>
`;
  writeFileSync(out, html, 'utf8');
  return { ok: true, wiki_dir: wiki.wikiDir, output: out, modules: wiki.index.modules.length, lenses: wiki.lenses.length, variants: totalVariants };
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help')) {
    console.log('Usage: build-wiki-viewer.mjs [--wiki-dir <Wiki>] [--output <wiki-viewer.html>]');
    return;
  }
  const flag = (name) => {
    const idx = argv.indexOf(name);
    return idx >= 0 ? argv[idx + 1] : null;
  };
  const wikiDir = resolve(flag('--wiki-dir') || join(HERE, 'base-wiki'));
  const outputPath = flag('--output') ? resolve(flag('--output')) : join(wikiDir, 'wiki-viewer.html');
  const receipt = buildWikiViewer({ wikiDir, outputPath });
  console.log(JSON.stringify(receipt, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
