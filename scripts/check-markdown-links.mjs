import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const excludedDirectories = new Set(['.git', '.next', 'coverage', 'dist', 'node_modules']);
const markdownFiles = await collectMarkdownFiles(repoRoot);
const failures = [];

for (const markdownFile of markdownFiles) {
  const content = await readFile(markdownFile, 'utf8');
  const searchableContent = content
    .replace(/```[\s\S]*?```/g, '')
    .replace(/~~~[\s\S]*?~~~/g, '')
    .replace(/`[^`\r\n]*`/g, '');
  const links = [
    ...searchableContent.matchAll(/!?\[[^\]]*\]\((?<target>[^)]+)\)/g),
    ...searchableContent.matchAll(/<(?:img|source)[^>]+(?:src|srcset)=["'](?<target>[^"']+)["'][^>]*>/gi),
  ];

  for (const match of links) {
    const rawTarget = match.groups?.target?.trim();
    if (!rawTarget || shouldIgnore(rawTarget)) continue;

    const normalizedTarget = normalizeTarget(rawTarget);
    if (!normalizedTarget) continue;

    const resolvedPath = path.resolve(path.dirname(markdownFile), normalizedTarget);
    if (!isInsideRepo(resolvedPath)) {
      failures.push({ file: relative(markdownFile), target: rawTarget, reason: 'escapes repository' });
      continue;
    }

    try {
      await access(resolvedPath);
    } catch {
      failures.push({ file: relative(markdownFile), target: rawTarget, reason: 'missing target' });
    }
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    process.stderr.write(`${failure.file}: ${failure.reason}: ${failure.target}\n`);
  }
  process.stderr.write(`Found ${failures.length} broken local Markdown link(s).\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Validated local links in ${markdownFiles.length} Markdown files.\n`);
}

async function collectMarkdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!excludedDirectories.has(entry.name)) {
        files.push(...await collectMarkdownFiles(path.join(directory, entry.name)));
      }
      continue;
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      files.push(path.join(directory, entry.name));
    }
  }

  return files;
}

function shouldIgnore(target) {
  return target.startsWith('#')
    || /^[a-z][a-z0-9+.-]*:/i.test(target)
    || target.startsWith('//')
    || target.includes('<')
    || target.includes('>');
}

function normalizeTarget(target) {
  const withoutTitle = target.replace(/\s+["'][^"']*["']\s*$/, '').trim();
  const withoutAnchor = withoutTitle.split('#', 1)[0].split('?', 1)[0];
  if (!withoutAnchor) return null;

  try {
    return decodeURIComponent(withoutAnchor);
  } catch {
    return withoutAnchor;
  }
}

function isInsideRepo(targetPath) {
  const relativePath = path.relative(repoRoot, targetPath);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function relative(targetPath) {
  return path.relative(repoRoot, targetPath).replaceAll('\\', '/');
}
