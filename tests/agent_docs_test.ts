/** #135: drift guard for the agent-instruction architecture.
 *
 * The root AGENTS.md is the compact always-loaded entry point and routes
 * conditional guidance to standard Agent Skills under .agents/skills/.
 * These tests pin that contract:
 *
 *  - the root AGENTS.md stays within a 12 KiB UTF-8 byte budget (target
 *    8–10 KiB) so it fits every harness's project-instruction window;
 *  - every `.agents/skills/<name>/SKILL.md` path referenced by the root
 *    routing table exists on disk;
 *  - every skill directory under `.agents/skills/` is routed from the
 *    root file;
 *  - every SKILL.md has YAML frontmatter with non-empty `name` and
 *    `description`, and `name` matches its containing directory;
 *  - the retired `docs/agent-guides/` layout never reappears.
 */

import { assert, assertEquals, assertMatch } from '@std/assert';

const repoRoot = new URL('../', import.meta.url);

const AGENTS_BUDGET_BYTES = 12 * 1024;
const SKILL_PATH_RE = /\.agents\/skills\/([a-z0-9-]+)\/SKILL\.md/g;

function readRepoText(rel: string): Promise<string> {
  return Deno.readTextFile(new URL(rel, repoRoot));
}

function routedSkillPaths(agentsMd: string): Map<string, string> {
  const routed = new Map<string, string>();
  for (const m of agentsMd.matchAll(SKILL_PATH_RE)) {
    routed.set(m[1], m[0]);
  }
  return routed;
}

Deno.test('agent docs: root AGENTS.md fits the 12 KiB instruction budget', async () => {
  const bytes = await Deno.readFile(new URL('AGENTS.md', repoRoot));
  assert(
    bytes.byteLength <= AGENTS_BUDGET_BYTES,
    `AGENTS.md is ${bytes.byteLength} bytes; the budget is ${AGENTS_BUDGET_BYTES}. ` +
      'Move detail into the matching skill under .agents/skills/ instead.',
  );
});

Deno.test('agent docs: no legacy docs/agent-guides paths', async () => {
  const agentsMd = await readRepoText('AGENTS.md');
  assert(
    !agentsMd.includes('docs/agent-guides'),
    'AGENTS.md references docs/agent-guides, which was retired in favor of .agents/skills/.',
  );
});

Deno.test('agent docs: every skill routed from AGENTS.md exists and has valid frontmatter', async () => {
  const agentsMd = await readRepoText('AGENTS.md');
  const routed = routedSkillPaths(agentsMd);
  assert(routed.size > 0, 'AGENTS.md routes no .agents/skills/ paths.');
  for (const [name, path] of routed) {
    await validateSkill(name, path);
  }
});

Deno.test('agent docs: every skill directory is routed from AGENTS.md', async () => {
  const agentsMd = await readRepoText('AGENTS.md');
  const routed = routedSkillPaths(agentsMd);
  const onDisk: string[] = [];
  for await (const entry of Deno.readDir(new URL('.agents/skills/', repoRoot))) {
    if (entry.isDirectory) onDisk.push(entry.name);
  }
  assert(onDisk.length > 0, 'no skills found under .agents/skills/');
  onDisk.sort();
  const routedNames = [...routed.keys()].sort();
  assertEquals(
    onDisk,
    routedNames,
    'skill directories on disk and skills routed from AGENTS.md differ',
  );
  for (const name of onDisk) {
    await validateSkill(name, `.agents/skills/${name}/SKILL.md`);
  }
});

async function validateSkill(expectedName: string, relPath: string): Promise<void> {
  let text: string;
  try {
    text = await readRepoText(relPath);
  } catch (err) {
    throw new Error(`${relPath} is routed from AGENTS.md but could not be read: ${err}`);
  }
  const fm = text.match(/^---\n([\s\S]*?)\n---\n/);
  assert(fm, `${relPath}: missing YAML frontmatter block`);
  const name = fm[1].match(/^name:[ \t]*(\S.*)$/m)?.[1]?.trim();
  const description = fm[1].match(/^description:[ \t]*(\S.*)$/m)?.[1]?.trim();
  assert(name, `${relPath}: frontmatter 'name' is missing or empty`);
  assert(description, `${relPath}: frontmatter 'description' is missing or empty`);
  assertMatch(
    name,
    /^[a-z0-9-]+$/,
    `${relPath}: 'name' must use lowercase letters, digits, hyphens`,
  );
  assertEquals(
    name,
    expectedName,
    `${relPath}: frontmatter 'name' must match its containing directory`,
  );
}
