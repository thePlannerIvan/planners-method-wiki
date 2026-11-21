#!/usr/bin/env node
/**
 * 校验 Karpathy LLM Wiki（Markdown 版）的结构、frontmatter、页面表达结构与双向链接完整性。
 * 用法：node scripts/lint-wiki.mjs [--wiki-dir <Wiki>] [--text]
 */
import { existsSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { REQUIRED_LENS_SECTIONS, loadWiki } from './lib/wiki-markdown.mjs';

const HELP = `Usage: lint-wiki.mjs [--wiki-dir <Wiki>] [--text]
Checks SCHEMA.md, index.md, log.md, lenses/*.md frontmatter, required sections,
broken links, and orphan pages. Exit 0 if valid, 1 on errors, 2 on bad usage.\n`;

export function lintWiki(wikiDir) {
  const root = resolve(wikiDir);
  const errors = [];
  const warnings = [];
  const err = (code, message, file = null) => errors.push({ code, message, ...(file ? { file } : {}) });
  const warn = (code, message, file = null) => warnings.push({ code, message, ...(file ? { file } : {}) });

  for (const req of ['SCHEMA.md', 'index.md', 'log.md']) {
    const p = join(root, req);
    if (!existsSync(p) || !statSync(p).isFile()) err('missing_core_file', `缺少核心文件 ${req}`, req);
  }
  if (errors.some((e) => e.file === 'index.md')) {
    return { valid: false, wiki_dir: root, modules: 0, lenses: 0, errors, warnings };
  }

  const wiki = loadWiki(root);
  const seenIds = new Set();
  const diskRelPaths = new Set();

  for (const lens of wiki.lenses) {
    const rel = lens.rel_path;
    diskRelPaths.add(rel);
    const fm = lens.frontmatter;
    if (!fm || typeof fm !== 'object' || !fm.id) {
      err('frontmatter_missing', `${rel} 缺少 frontmatter 或 id`, rel);
      continue;
    }
    for (const field of ['id', 'name', 'module_id', 'status']) {
      if (!fm[field] || !String(fm[field]).trim()) err('frontmatter_field', `${rel} 缺少字段 ${field}`, rel);
    }
    if (!['approved', 'draft'].includes(fm.status)) {
      err('invalid_status', `${rel} 的 status 必须是 approved 或 draft，实际 ${fm.status}`, rel);
    }
    if (seenIds.has(fm.id)) err('duplicate_lens_id', `重复的 lens id：${fm.id}`, rel);
    seenIds.add(fm.id);

    const expectedFile = `${fm.id}.md`;
    if (basename(rel) !== expectedFile) {
      err('filename_mismatch', `${rel} 文件名应与 frontmatter id 一致（${expectedFile}）`, rel);
    }

    for (const sec of REQUIRED_LENS_SECTIONS) {
      if (!lens.sectionsPresent.includes(sec)) {
        err('missing_section', `${rel} 缺少必填章节「## ${sec}」`, rel);
      }
    }
    if (!lens.question || lens.question === '（暂无）') {
      err('empty_question', `${rel} 的「## 解决的问题」不能为空`, rel);
    }
    if (!lens.analysis_operations.length) {
      err('empty_operations', `${rel} 至少需要一条分析操作步骤`, rel);
    }
    if (!lens.page_structure.length) {
      warn('page_structure_pending', `${rel} 尚未补充「## 页面表达结构」`, rel);
    }
  }

  const linkedRelPaths = new Set();
  for (const link of wiki.index.links) {
    const target = resolve(root, link.href);
    if (!existsSync(target) || !statSync(target).isFile()) {
      err('broken_index_link', `index.md 引用了不存在的页面：${link.href}`, 'index.md');
    } else if (linkedRelPaths.has(link.href)) {
      err('duplicate_index_link', `index.md 重复链接了 ${link.href}`, 'index.md');
    } else {
      linkedRelPaths.add(link.href);
    }
  }

  for (const rel of diskRelPaths) {
    if (!linkedRelPaths.has(rel)) {
      err('orphan_lens_page', `孤儿方法页（未在 index.md 收录）：${rel}`, rel);
    }
  }

  return {
    valid: errors.length === 0,
    wiki_dir: root,
    modules: wiki.index.modules.length,
    lenses: wiki.lenses.length,
    lenses_with_page_structure: wiki.lenses.filter((l) => l.page_structure.length > 0).length,
    variants: wiki.lenses.reduce((n, l) => n + l.variants.length, 0),
    errors,
    warnings,
  };
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help')) { process.stdout.write(HELP); return; }
  const text = argv.includes('--text');
  const dirFlag = argv.indexOf('--wiki-dir');
  const wikiDir = dirFlag >= 0 ? argv[dirFlag + 1] : resolve(import.meta.dirname, '../base-wiki');
  if (!wikiDir || wikiDir.startsWith('--')) {
    console.error(HELP);
    process.exit(2);
  }
  const report = lintWiki(wikiDir);
  if (text) {
    for (const w of report.warnings) console.log(`WARN  [${w.code}] ${w.message}`);
    for (const e of report.errors) console.log(`ERROR [${e.code}] ${e.message}`);
    console.log(report.valid
      ? `\n合规：${report.modules} 模块 · ${report.lenses} 个方法（${report.lenses_with_page_structure} 个含页面表达结构）· ${report.variants} 个变体；${report.warnings.length} 个警告`
      : `\n不合规：${report.errors.length} 个错误、${report.warnings.length} 个警告`);
  } else {
    console.log(JSON.stringify(report, null, 2));
  }
  process.exit(report.valid ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
