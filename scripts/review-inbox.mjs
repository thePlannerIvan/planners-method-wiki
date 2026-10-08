#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { FEEDBACK_REL, SUBMISSIONS_REL, feedbackPath, contextPath, resolveSurfacePaths } from './review-surface.mjs';
import { argumentsOf, isMain, runCli } from './lib/cli.mjs';
import { contract } from './lib/method-contracts.mjs';
import { validateFeedback, validateBundle, hash } from './lib/review-validation.mjs';

const LIFTED = ['pre_check', 'pre_check_note', 'overall_note_zh'];
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
function atomicWrite(path, value) {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, path);
}

export function importSubmission(surfaceFile) {
  const paths = resolveSurfacePaths(surfaceFile);
  const reviewDir = dirname(paths.surface);
  const target = feedbackPath(reviewDir);
  const receipt = { ok: true, surface: paths.surface, review_dir: reviewDir,
    submissions: paths.submissions, feedback: target, imported: null, rejected: [] };
  if (!paths.submissions || !existsSync(paths.submissions)) {
    receipt.status = 'no_submission';
    receipt.skipped = 'No submission for this review';
    receipt.next_action_zh = '尚无本轮提交，不能使用已有反馈继续安装。';
    return receipt;
  }
  try {
    const submissionRaw = readFileSync(paths.submissions, 'utf8');
    const submission = JSON.parse(submissionRaw);
    const bundlePath = join(reviewDir, 'review-bundle.json');
    const bundleRaw = readFileSync(bundlePath, 'utf8');
    const bundle = JSON.parse(bundleRaw);
    const context = readJson(contextPath(reviewDir));
    const currentHash = hash(bundleRaw);
    if (!submission || typeof submission !== 'object' || Array.isArray(submission)) throw new Error('Submission must be an object');
    if (!submission.review_bundle_sha256 || submission.review_bundle_sha256 !== currentHash) throw new Error('Missing or stale submission review_bundle_sha256');
    if (context.review_bundle_sha256 !== currentHash || context.bundle_path !== bundlePath) throw new Error('Missing or stale review context');
    if (submission.route !== bundle.route) throw new Error('Submission route differs from bundle');
    const bundleCheck = validateBundle(bundle);
    if (!bundleCheck.valid) throw new Error(bundleCheck.errors.join('; '));
    if (submission.pre_check === false && /stale|已经变了/.test(submission.pre_check_note || '')) throw new Error('Page reported a stale bundle');
    const declared = new Set(Object.keys(contract('review-feedback.schema.json').properties));
    const unknown = Object.keys(submission).filter(key => !declared.has(key) && !LIFTED.includes(key));
    if (unknown.length) throw new Error(`Unknown submission fields: ${unknown.join(', ')}`);
    if (submission.pre_check !== undefined && typeof submission.pre_check !== 'boolean') throw new Error('Invalid pre_check');
    for (const key of ['pre_check_note', 'overall_note_zh']) if (submission[key] !== undefined && typeof submission[key] !== 'string') throw new Error(`Invalid ${key}`);
    for (const key of LIFTED) if (Object.hasOwn(submission, key)) receipt[key] = submission[key];
    const native = Object.fromEntries(Object.entries(submission).filter(([key]) => declared.has(key)));
    // Partial reviews are importable, but the default installation gate still requires full coverage.
    const check = validateFeedback(bundle, native, bundleRaw, { approvedOnly: true });
    if (!check.valid) throw new Error(check.errors.join('; '));
    const overallNote = submission.overall_note_zh?.trim() || '';
    const markerPath = join(reviewDir, 'review-inbox-receipt.json');
    let marker = null;
    if (existsSync(markerPath)) {
      try { marker = readJson(markerPath); }
      catch { receipt.warnings = ['Previous deduplication receipt was unreadable; processing current submission']; }
    }
    const submissionHash = hash(submissionRaw);
    const overallOnly = native.decisions.length === 0 && !!overallNote;
    if (!native.decisions.length && !overallOnly) throw new Error('Empty decisions require an overall note');
    if (overallOnly) {
      // A newer whole-note submission revokes the previous native authorization.
      if (existsSync(target)) unlinkSync(target);
      receipt.status = marker?.submission_sha256 === submissionHash ? 'duplicate_submission' : 'overall_only';
      receipt.imported = { native_written: false, overall_only: true, overall_note_zh: overallNote, previous_approval_invalidated: true };
      receipt.next_action_zh = '仅整体意见已收件，旧逐项批准已失效。先返修，不得继续安装。';
    } else {
      const duplicate = marker?.submission_sha256 === submissionHash && existsSync(target)
        && hash(readFileSync(target, 'utf8')) === marker.native_sha256;
      if (!duplicate) atomicWrite(target, native);
      receipt.status = duplicate ? 'duplicate_submission' : 'feedback_imported';
      receipt.imported = { native_written: !duplicate, overall_only: false, feedback: FEEDBACK_REL, decisions: native.decisions.length, reviewer: native.reviewer };
      receipt.next_action_zh = '收件完成。默认逐项校验通过后再安装；部分安装必须显式选择 --approved-only。';
    }
    receipt.units = { count: native.decisions.length, label: '方法' };
    atomicWrite(markerPath, { review_bundle_sha256: currentHash, submission_sha256: submissionHash,
      native_sha256: overallOnly ? null : hash(readFileSync(target, 'utf8')), overall_only: overallOnly });
  } catch (error) {
    receipt.ok = false;
    receipt.status = 'rejected_submission';
    receipt.rejected.push(error.message);
    receipt.next_action_zh = '提交未通过当前审阅包校验，未覆盖反馈；本轮不能继续安装。';
  }
  return receipt;
}

export function main(argv) {
  const args = argumentsOf(argv);
  if (args['--help']) return { usage: 'review-inbox.mjs --surface <review-surface.json> (or --review-dir <review>)' };
  const surface = args['--surface'] || (args['--review-dir'] && join(args['--review-dir'], 'review-surface.json'));
  if (!surface) throw new Error('Missing --surface or --review-dir');
  return importSubmission(resolve(surface));
}
if (isMain(import.meta.url)) runCli(main);

export function submissionsRel(surfaceFile) {
  return relative(dirname(resolve(surfaceFile)), resolve(dirname(resolve(surfaceFile)), SUBMISSIONS_REL)).split('\\').join('/');
}
