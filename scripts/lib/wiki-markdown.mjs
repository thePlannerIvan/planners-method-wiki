import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const REQUIRED_LENS_SECTIONS = [
  '解决的问题',
  '适用与跳过条件',
  '所需输入',
  '分析操作步骤',
  '页面表达结构',
  '输出与失效边界',
  '案例证据与变体',
];

function parseFrontmatterScalar(raw) {
  const value = raw.trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('[') && value.endsWith(']'))) {
    try { return JSON.parse(value); } catch { /* fall through */ }
  }
  if ((value.startsWith("'") && value.endsWith("'"))) return value.slice(1, -1);
  return value;
}

export function parseFrontmatter(markdown) {
  const normalized = String(markdown).replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { frontmatter: null, body: normalized };
  const frontmatter = {};
  for (const line of match[1].split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colon = trimmed.indexOf(':');
    if (colon <= 0) continue;
    const key = trimmed.slice(0, colon).trim();
    const val = trimmed.slice(colon + 1);
    frontmatter[key] = parseFrontmatterScalar(val);
  }
  return { frontmatter, body: match[2] };
}

function splitSections(markdown, levelPrefix) {
  const lines = String(markdown).split('\n');
  const sections = [];
  let current = null;
  for (const line of lines) {
    if (line.startsWith(levelPrefix) && !line.startsWith(levelPrefix + '#')) {
      if (current) sections.push(current);
      current = { heading: line.slice(levelPrefix.length).trim(), lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) sections.push(current);
  return sections.map((s) => ({ heading: s.heading, body: s.lines.join('\n').trim() }));
}

function parseBulletItems(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^-\s+/.test(line))
    .map((line) => line.replace(/^-\s+/, '').trim())
    .filter((item) => item && item !== '（暂无）');
}

function parseOrderedItems(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^\d+\.\s+/.test(line))
    .map((line) => line.replace(/^\d+\.\s+/, '').trim())
    .filter((item) => item && item !== '（暂无）');
}

function parsePageStructure(body) {
  if (!body || body.includes('（待补充')) return [];
  const subs = splitSections(body, '### ');
  const pages = [];
  for (const sub of subs) {
    const headMatch = sub.heading.match(/^P(\d+)\s*[·:]\s*(.+)$/);
    const pageNum = headMatch ? Number(headMatch[1]) : pages.length + 1;
    const title = headMatch ? headMatch[2].trim() : sub.heading;
    const contentLines = [];
    const meta = {};
    for (const line of sub.body.split('\n')) {
      const m = line.match(/^- \*\*([^*]+)\*\*[：:]\s*(.*)$/);
      if (m) meta[m[1].trim()] = m[2].trim();
      else contentLines.push(line);
    }
    pages.push({
      page: pageNum,
      title,
      content: contentLines.join('\n').trim(),
      ...(meta['论证目的'] ? { purpose: meta['论证目的'] } : {}),
      ...(meta['回答问题'] ? { question: meta['回答问题'] } : {}),
      ...(meta['所需证据'] ? { required_evidence: meta['所需证据'].split('；').filter(Boolean) } : {}),
      ...(meta['信息关系'] ? { information_relationship: meta['信息关系'] } : {}),
      ...(meta['承接来源'] ? { connects_from: meta['承接来源'] } : {}),
      ...(meta['推向后续'] ? { connects_to: meta['推向后续'] } : {}),
      ...(meta['常见误用'] ? { common_misuse: meta['常见误用'] } : {}),
    });
  }
  return pages;
}

function parseVariants(body) {
  const subs = splitSections(body, '#### ');
  const variants = [];
  const recipes = [];
  for (const sub of subs) {
    if (sub.heading.startsWith('历史推导记录：')) {
      const m = sub.heading.match(/^历史推导记录：(.+?)\s*\(`([^`]+)`\)$/);
      recipes.push({
        recipe_id: m ? m[2] : '',
        name: m ? m[1] : sub.heading,
        body: sub.body,
      });
      continue;
    }
    const m = sub.heading.match(/^(.+?)\s*\(`([^`]+)`\)$/);
    const name = m ? m[1].trim() : sub.heading;
    const variant_id = m ? m[2].trim() : '';
    const use_conditions = [];
    const analysis_operations = [];
    let mode = null;
    for (const line of sub.body.split('\n')) {
      if (/^- \*\*适用条件\*\*/.test(line)) { mode = 'use'; continue; }
      if (/^- \*\*操作步骤\*\*/.test(line)) { mode = 'ops'; continue; }
      if (/^- \*\*来源实例\*\*/.test(line)) { mode = null; continue; }
      if (mode === 'use' && /^\s+-\s+/.test(line)) use_conditions.push(line.replace(/^\s+-\s+/, '').trim());
      if (mode === 'ops' && /^\s+\d+\.\s+/.test(line)) analysis_operations.push(line.replace(/^\s+\d+\.\s+/, '').trim());
    }
    variants.push({ variant_id, name, use_conditions, analysis_operations });
  }
  return { variants, historical_recipes: recipes };
}

export function parseLensMarkdown(filePath) {
  const raw = readFileSync(filePath, 'utf8');
  const { frontmatter, body } = parseFrontmatter(raw);
  const h2 = splitSections(body, '## ');
  const secMap = new Map(h2.map((s) => [s.heading, s.body]));

  const condSubs = new Map(splitSections(secMap.get('适用与跳过条件') || '', '### ').map((s) => [s.heading, s.body]));
  const outSubs = new Map(splitSections(secMap.get('输出与失效边界') || '', '### ').map((s) => [s.heading, s.body]));
  const evSubs = new Map(splitSections(secMap.get('案例证据与变体') || '', '### ').map((s) => [s.heading, s.body]));
  const { variants, historical_recipes } = parseVariants(evSubs.get('变体') || '');

  const evidenceRaw = (evSubs.get('案例证据') || '').trim();
  return {
    filePath,
    frontmatter: frontmatter || {},
    sectionsPresent: [...secMap.keys()],
    lens_id: frontmatter?.id || '',
    name: frontmatter?.name || '',
    aliases: Array.isArray(frontmatter?.aliases) ? frontmatter.aliases : [],
    module_id: frontmatter?.module_id || '',
    module_title: frontmatter?.module_title || '',
    status: frontmatter?.status || 'draft',
    updated: frontmatter?.updated || '',
    source_instances: Array.isArray(frontmatter?.source_instances) ? frontmatter.source_instances : [],
    question: (secMap.get('解决的问题') || '').trim(),
    use_conditions: parseBulletItems(condSubs.get('适用条件')),
    skip_conditions: parseBulletItems(condSubs.get('跳过条件')),
    required_inputs: parseBulletItems(secMap.get('所需输入')),
    analysis_operations: parseOrderedItems(secMap.get('分析操作步骤')),
    page_structure: parsePageStructure(secMap.get('页面表达结构') || ''),
    output_types: parseBulletItems(outSubs.get('预期输出')),
    failure_modes: parseBulletItems(outSubs.get('失效模式')),
    boundaries: parseBulletItems(outSubs.get('适用边界')),
    evidence: evidenceRaw === '（未附案例证据）' ? '' : evidenceRaw,
    variants,
    historical_recipes,
    raw,
  };
}

export function parseIndexMarkdown(indexPath) {
  const raw = readFileSync(indexPath, 'utf8');
  const h2 = splitSections(raw, '## ');
  const modules = [];
  const links = [];
  for (const sec of h2) {
    const m = sec.heading.match(/^M(\d+)\s*[·:]\s*(.+?)\s*\(`([^`]+)`\)$/);
    if (!m) continue;
    const mod = {
      order: Number(m[1]),
      title: m[2].trim(),
      module_id: m[3].trim(),
      decision: '',
      preconditions: [],
      lens_links: [],
    };
    for (const line of sec.body.split('\n')) {
      if (line.startsWith('> ')) mod.decision = line.slice(2).trim();
      const pre = line.match(/^- \*\*模块前提\*\*[：:]\s*(.+)$/);
      if (pre) mod.preconditions = pre[1].split('；').map((s) => s.trim()).filter(Boolean);
      const linkMatch = line.match(/^- \[([^\]]+)\]\(([^)]+)\)/);
      if (linkMatch) {
        const href = linkMatch[2].split('#')[0].trim();
        mod.lens_links.push({ label: linkMatch[1], href });
        links.push({ label: linkMatch[1], href, module_id: mod.module_id });
      }
    }
    modules.push(mod);
  }
  return { modules, links, raw };
}

export function loadWiki(wikiDir) {
  const root = resolve(wikiDir);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw Object.assign(new Error(`Wiki directory not found: ${root}`), { code: 'WIKI_NOT_FOUND', path: root });
  }
  const indexPath = join(root, 'index.md');
  const lensesDir = join(root, 'lenses');
  if (!existsSync(indexPath) || !statSync(indexPath).isFile()) {
    throw Object.assign(new Error(`Missing index.md in ${root}`), { code: 'INDEX_MISSING', path: indexPath });
  }
  const index = parseIndexMarkdown(indexPath);
  const files = existsSync(lensesDir) && statSync(lensesDir).isDirectory()
    ? readdirSync(lensesDir).filter((f) => f.endsWith('.md')).sort()
    : [];
  const lenses = files.map((file) => {
    const parsed = parseLensMarkdown(join(lensesDir, file));
    return { ...parsed, rel_path: `lenses/${file}` };
  });
  return { wikiDir: root, indexPath, lensesDir, index, lenses };
}
