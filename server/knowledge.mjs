/**
 * Pierre knowledge store.
 *
 * One Markdown file per document, YAML frontmatter for metadata. No database:
 * the folder is the store, so a team shares it by putting it in git.
 */
import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import matter from "gray-matter";

/** Resolve the knowledge directory. Defaults to ./knowledge next to the repo. */
export function knowledgeRoot() {
  // LUIA_KNOWLEDGE_DIR is the name from before the rename; installs that still
  // set it keep working.
  return resolve(
    process.env.PIERRE_KNOWLEDGE_DIR ?? process.env.LUIA_KNOWLEDGE_DIR ?? "./knowledge",
  );
}

/**
 * Confine a caller-supplied path to the knowledge root.
 *
 * `id` reaches us from the model, so it is untrusted input: without this a
 * crafted id like "../../.ssh/id_rsa" would read or overwrite files outside
 * the store entirely.
 */
function safePath(root, id) {
  const clean = String(id).replace(/\.md$/i, "");
  const full = resolve(root, `${clean}.md`);
  const rel = relative(root, full);
  if (rel.startsWith("..") || rel.startsWith(sep) || resolve(root, rel) !== full) {
    throw new Error(`Invalid document id: ${id}`);
  }
  return full;
}

async function walk(dir, root, out = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return out;
    throw err;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      await walk(full, root, out);
    } else if (entry.name.endsWith(".md")) {
      out.push(full);
    }
  }
  return out;
}

/** Read every document in the store. */
export async function loadAll() {
  const root = knowledgeRoot();
  const files = await walk(root, root);
  const docs = [];
  for (const file of files) {
    const raw = await readFile(file, "utf8");
    const { data, content } = matter(raw);
    const id = relative(root, file).replace(/\.md$/i, "").split(sep).join("/");
    docs.push({
      id,
      title: data.title ?? id.split("/").pop(),
      project: data.project ?? null,
      author: data.author ?? "team",
      tags: Array.isArray(data.tags) ? data.tags : [],
      created: data.created ?? null,
      body: content.trim(),
      path: file,
    });
  }
  return docs;
}

export async function readDoc(id) {
  const root = knowledgeRoot();
  const raw = await readFile(safePath(root, id), "utf8");
  const { data, content } = matter(raw);
  return { id, ...data, body: content.trim() };
}

/**
 * Create or replace a document.
 *
 * Writes frontmatter + body. `created` is stamped once and preserved on
 * rewrite, so editing a decision doesn't reset when the team first made it.
 */
export async function writeDoc({ id, title, body, project, author, tags }) {
  const root = knowledgeRoot();
  const full = safePath(root, id);
  await mkdir(join(full, ".."), { recursive: true });

  let created = new Date().toISOString().slice(0, 10);
  try {
    const existing = matter(await readFile(full, "utf8"));
    if (existing.data.created) created = existing.data.created;
  } catch {
    // new document
  }

  const front = {
    title,
    ...(project ? { project } : {}),
    author: author ?? "team",
    ...(tags?.length ? { tags } : {}),
    created,
  };
  await writeFile(full, matter.stringify(`\n${body.trim()}\n`, front), "utf8");
  return { id, path: full, created };
}

/**
 * Score a document against a query.
 *
 * Deliberately plain keyword scoring rather than embeddings: it needs no API
 * key, no index to rebuild, and no network call, which keeps the whole server
 * a dependency-light thing a designer can run locally.
 */
export function score(doc, query) {
  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  if (!terms.length) return 0;
  const title = doc.title.toLowerCase();
  const tags = doc.tags.join(" ").toLowerCase();
  const body = doc.body.toLowerCase();
  const project = (doc.project ?? "").toLowerCase();

  let total = 0;
  for (const term of terms) {
    if (title.includes(term)) total += 10;
    if (tags.includes(term)) total += 6;
    if (project.includes(term)) total += 4;
    const hits = body.split(term).length - 1;
    total += Math.min(hits, 5);
  }
  return total;
}

/** Best-matching documents for a query, highest score first. */
export async function search(query, { project, limit = 5 } = {}) {
  const docs = await loadAll();
  return docs
    .filter((d) => !project || d.project === project)
    .map((doc) => ({ doc, s: score(doc, query) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((r) => r.doc);
}

/** A short excerpt around the first matching term, for search results. */
export function excerpt(doc, query, len = 320) {
  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  const lower = doc.body.toLowerCase();
  let at = -1;
  for (const term of terms) {
    at = lower.indexOf(term);
    if (at !== -1) break;
  }
  if (at === -1) return doc.body.slice(0, len).trim();
  const start = Math.max(0, at - 100);
  return (start > 0 ? "…" : "") + doc.body.slice(start, start + len).trim() + "…";
}
