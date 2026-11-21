#!/usr/bin/env node
/**
 * 检索 Markdown 方法库（Karpathy LLM Wiki）。
 * 用法：node scripts/query-wiki.mjs --query <关键词> [--wiki-dir <Wiki>] [--module <mod_id>] [--limit 5] [--text]
 */
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadWiki } from './lib/wiki-markdown.mjs';

const HELP = `Usage: query-wiki.mjs --query <keywords> [--wiki-dir <Wiki>] [--module <mod_id>] [--type lens|all] [--limit 5] [--text]
Defaults: --wiki-dir <Skill>/base-wiki, --limit 5 (1-12).
Success (including zero matches): exit 0, ok=true. Invalid arguments or Wiki: exit 2, ok=false.\n`;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === '--text' || key === '--help') { args[key] = true; continue; }
    if (!['--wiki-dir', '--query', '--type', '--limit', '--module'].includes(key)) {
      throw new Error(`Unknown option: ${key}`);
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
    args[key] = value;
    i += 1;
  }
  return args;
}

export function queryTerms(query) {
  const chunks = String(query).toLowerCase().split(/[\s,，、；;|/。！？!?：:（）()]+/u).filter(Boolean);
  const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });
  const stopwords = new Set(['如何', '怎么', '怎样', '什么', '需要', '可以', '一个', '我们', '进行', '通过', '找到']);
  const words = chunks.filter((c) => /\p{Script=Han}/u.test(c))
    .flatMap((c) => [...segmenter.segment(c)].filter((p) => p.isWordLike && p.segment.length > 1).map((p) => p.segment));
  return [...new Set([...chunks, ...words].filter((t) => !stopwords.has(t)))];
}

function scoreFields(fields, terms) {
  const matches = [];
  for (const [field, raw] of Object.entries(fields)) {
    const text = (Array.isArray(raw) ? raw.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('\n') : String(raw || '')).toLowerCase();
    for (const term of terms) {
      const occ = text.split(term).length - 1;
      if (occ > 0) matches.push({ field, term, occurrences: occ });
    }
  }
  return {
    score: matches.reduce((sum, m) => sum + m.occurrences, 0),
    matched_terms: terms.filter((t) => matches.some((m) => m.term === t)),
    matched_fields: matches,
  };
}

export function queryWiki(wiki, { query, moduleId = null, limit = 5 }) {
  if (typeof query !== 'string' || !query.trim()) throw new Error('--query requires nonempty keywords');
  if (!Number.isInteger(limit) || limit < 1 || limit > 12) throw new Error('--limit must be an integer from 1 to 12');
  const terms = queryTerms(query);
  if (!terms.length) throw new Error('--query contains no searchable tokens');

  const results = [];
  for (const lens of wiki.lenses) {
    if (moduleId && lens.module_id !== moduleId) continue;
    const match = scoreFields({
      lens_id: lens.lens_id,
      name: lens.name,
      aliases: lens.aliases,
      module_id: lens.module_id,
      module_title: lens.module_title,
      question: lens.question,
      use_conditions: lens.use_conditions,
      analysis_operations: lens.analysis_operations,
      page_structure: lens.page_structure,
      variants: lens.variants,
      boundaries: lens.boundaries,
    }, terms);
    if (!match.score) continue;
    results.push({
      id: lens.lens_id,
      lens_id: lens.lens_id,
      name: lens.name,
      module_id: lens.module_id,
      module_title: lens.module_title,
      status: lens.status,
      question: lens.question,
      use_conditions: lens.use_conditions,
      skip_conditions: lens.skip_conditions,
      required_inputs: lens.required_inputs,
      analysis_operations: lens.analysis_operations,
      page_structure: lens.page_structure,
      output_types: lens.output_types,
      failure_modes: lens.failure_modes,
      boundaries: lens.boundaries,
      variants: lens.variants,
      source_path: lens.rel_path,
      source_absolute_path: join(wiki.wikiDir, lens.rel_path),
      ...match,
    });
  }
  results.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    ok: true,
    wiki_dir: wiki.wikiDir,
    query,
    terms,
    limit,
    total_matches: results.length,
    returned: Math.min(limit, results.length),
    results: results.slice(0, limit),
    note: '只读检索结果用于启发分析思路与页面结构；不得替代项目资料生成事实结论。',
  };
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help')) { process.stdout.write(HELP); return; }
  let wikiDir = null;
  try {
    const args = parseArgs(argv);
    wikiDir = resolve(args['--wiki-dir'] || resolve(import.meta.dirname, '../base-wiki'));
    const limit = args['--limit'] === undefined ? 5 : Number(args['--limit']);
    const type = args['--type'] || 'lens';
    if (!['lens', 'all'].includes(type)) throw new Error('--type must be lens or all');
    const out = queryWiki(loadWiki(wikiDir), { query: args['--query'], moduleId: args['--module'] || null, limit });
    if (args['--text']) {
      console.log(`命中 ${out.total_matches} 条（返回 ${out.returned} 条）：`);
      for (const r of out.results) {
        console.log(`\n- [${r.status}] ${r.name} (${r.lens_id}) · 分数 ${r.score}`);
        console.log(`  问题：${r.question}`);
        console.log(`  文件：${r.source_absolute_path}`);
        if (r.page_structure.length) console.log(`  页面表达：${r.page_structure.map((p) => `P${p.page} ${p.title}`).join(' → ')}`);
      }
    } else {
      console.log(JSON.stringify(out, null, 2));
    }
  } catch (error) {
    console.error(JSON.stringify({ ok: false, wiki_dir: wikiDir, error: { code: error.code || 'QUERY_ERROR', message: error.message } }, null, 2));
    process.exit(2);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
