/** #135, hardened by #142: drift guard for the agent-instruction
 * architecture.
 *
 * The root AGENTS.md is the compact always-loaded entry point and routes
 * conditional guidance to standard Agent Skills under .agents/skills/.
 * These tests pin that contract against the shared Agent Skills
 * specification baseline (https://agentskills.io/specification):
 *
 *  - the root AGENTS.md stays within a 12 KiB UTF-8 byte budget (target
 *    8–10 KiB) so it fits every harness's project-instruction window;
 *  - every `.agents/skills/<name>/SKILL.md` path referenced by the root
 *    routing table exists on disk, is routed exactly once, and every
 *    on-disk skill directory is routed;
 *  - every SKILL.md carries syntactically valid YAML frontmatter whose
 *    `name` (1–64 chars, lowercase letters/digits/hyphens, no leading,
 *    trailing, or consecutive hyphens) matches its containing directory,
 *    whose `description` is 1–1024 characters, and whose Markdown body
 *    after the frontmatter is non-empty;
 *  - the retired `docs/agent-guides/` layout can never reappear — neither
 *    referenced in root nor present as a directory;
 *  - the canonical editorial guide docs/narrative-guide.md exists and the
 *    emberdawn-narrative-writing skill routes to it.
 */

import { assert, assertEquals, assertMatch } from '@std/assert';
import { parse } from '@std/yaml';

const repoRoot = new URL('../', import.meta.url);

const AGENTS_BUDGET_BYTES = 12 * 1024;
const SKILL_PATH_RE = /\.agents\/skills\/([a-z0-9-]+)\/SKILL\.md/g;
const SKILL_NAME_RE = /^[a-z0-9-]+$/;
const NAME_MAX = 64;
const DESCRIPTION_MAX = 1024;
const NARRATIVE_GUIDE = 'docs/narrative-guide.md';
const NARRATIVE_SKILL = '.agents/skills/emberdawn-narrative-writing/SKILL.md';

function readRepoText(rel: string): Promise<string> {
  return Deno.readTextFile(new URL(rel, repoRoot));
}

/** Every `.agents/skills/<name>/SKILL.md` reference in root, in order.
 * Duplicates are preserved here so the routing test can reject them
 * instead of letting a Map silently collapse them. */
function routedSkillPaths(agentsMd: string): { name: string; path: string }[] {
  return [...agentsMd.matchAll(SKILL_PATH_RE)].map((m) => ({ name: m[1], path: m[0] }));
}

Deno.test('agent docs: root AGENTS.md fits the 12 KiB instruction budget', async () => {
  const bytes = await Deno.readFile(new URL('AGENTS.md', repoRoot));
  assert(
    bytes.byteLength <= AGENTS_BUDGET_BYTES,
    `AGENTS.md is ${bytes.byteLength} bytes; the budget is ${AGENTS_BUDGET_BYTES}. ` +
      'Move detail into the matching skill under .agents/skills/ instead.',
  );
});

Deno.test('agent docs: the retired docs/agent-guides layout never reappears', async () => {
  const agentsMd = await readRepoText('AGENTS.md');
  assert(
    !agentsMd.includes('docs/agent-guides'),
    'AGENTS.md references docs/agent-guides, which was retired in favor of .agents/skills/.',
  );
  let dirExists = true;
  try {
    await Deno.stat(new URL('docs/agent-guides/', repoRoot));
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) dirExists = false;
    else throw err;
  }
  assert(!dirExists, 'docs/agent-guides/ exists on disk; use .agents/skills/ instead.');
});

Deno.test('agent docs: routing is bidirectional, duplicate-free, and every skill is valid', async () => {
  const agentsMd = await readRepoText('AGENTS.md');
  const routed = routedSkillPaths(agentsMd);
  assert(routed.length > 0, 'AGENTS.md routes no .agents/skills/ paths.');
  const routedNames = routed.map((r) => r.name);
  assertEquals(
    new Set(routedNames).size,
    routedNames.length,
    `duplicate skill routes in AGENTS.md: ${routedNames.join(', ')}`,
  );

  const onDisk: string[] = [];
  for await (const entry of Deno.readDir(new URL('.agents/skills/', repoRoot))) {
    if (entry.isDirectory) onDisk.push(entry.name);
  }
  assert(onDisk.length > 0, 'no skills found under .agents/skills/');
  assertEquals(
    [...onDisk].sort(),
    [...routedNames].sort(),
    'skill directories on disk and skills routed from AGENTS.md differ',
  );

  for (const { name, path } of routed) {
    await validateSkill(name, path);
  }
});

Deno.test('agent docs: the canonical narrative guide exists and is routed by the narrative skill', async () => {
  // The editorial contract must exist on disk…
  let guide: string;
  try {
    guide = await readRepoText(NARRATIVE_GUIDE);
  } catch (err) {
    throw new Error(`${NARRATIVE_GUIDE} is missing: ${err}`);
  }
  assert(guide.trim().length > 0, `${NARRATIVE_GUIDE} is empty`);
  // …and the narrative-writing skill must actually route to it.
  const skill = await readRepoText(NARRATIVE_SKILL);
  assert(
    skill.includes(NARRATIVE_GUIDE),
    `${NARRATIVE_SKILL} does not route to ${NARRATIVE_GUIDE}`,
  );
});

async function validateSkill(expectedName: string, relPath: string): Promise<void> {
  let text: string;
  try {
    text = await readRepoText(relPath);
  } catch (err) {
    throw new Error(`${relPath} is routed from AGENTS.md but could not be read: ${err}`);
  }
  const fm = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  assert(fm, `${relPath}: missing YAML frontmatter block`);

  // Frontmatter must be syntactically valid YAML, not just line-shaped text.
  let meta: unknown;
  try {
    meta = parse(fm[1]);
  } catch (err) {
    throw new Error(`${relPath}: frontmatter is not valid YAML: ${err}`);
  }
  assert(
    typeof meta === 'object' && meta !== null && !Array.isArray(meta),
    `${relPath}: frontmatter must be a YAML mapping`,
  );
  const { name, description } = meta as Record<string, unknown>;

  // name: 1–64 chars, lowercase letters/digits/hyphens, no leading,
  // trailing, or consecutive hyphens, and identical to the directory.
  assert(typeof name === 'string' && name.length > 0, `${relPath}: 'name' is missing or empty`);
  assert(name.length <= NAME_MAX, `${relPath}: 'name' exceeds ${NAME_MAX} characters`);
  assertMatch(
    name,
    SKILL_NAME_RE,
    `${relPath}: 'name' must use lowercase letters, digits, hyphens`,
  );
  assert(!name.startsWith('-'), `${relPath}: 'name' must not start with a hyphen`);
  assert(!name.endsWith('-'), `${relPath}: 'name' must not end with a hyphen`);
  assert(!name.includes('--'), `${relPath}: 'name' must not contain consecutive hyphens`);
  assertEquals(
    name,
    expectedName,
    `${relPath}: frontmatter 'name' must match its containing directory`,
  );

  // description: 1–1024 characters; states capability and when to trigger.
  assert(
    typeof description === 'string' && description.length > 0,
    `${relPath}: 'description' is missing or empty`,
  );
  assert(
    description.length <= DESCRIPTION_MAX,
    `${relPath}: 'description' exceeds ${DESCRIPTION_MAX} characters`,
  );

  // A skill is instructions, not just metadata: the Markdown body must
  // carry content after the frontmatter block.
  assert(fm[2].trim().length > 0, `${relPath}: empty Markdown body after frontmatter`);
}
