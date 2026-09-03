import { assert, assertEquals } from '@std/assert';
import { parse as parseYaml } from '@std/yaml';

const AGENTS_MD_URL = new URL('../AGENTS.md', import.meta.url);
const REPO_ROOT_URL = new URL('../', import.meta.url);
const SKILLS_DIR_URL = new URL('../.agents/skills/', import.meta.url);
const MAX_BYTES_CEILING = 12 * 1024; // 12 KiB

const EXPECTED_SKILLS = new Set([
  'emberdawn-architecture',
  'emberdawn-combat',
  'emberdawn-content-authoring',
  'emberdawn-design-decisions',
  'emberdawn-narrative-writing',
  'emberdawn-persistence',
  'emberdawn-release',
  'emberdawn-story-and-quests',
]);

Deno.test('agent docs: root AGENTS.md size does not exceed 12 KiB ceiling (#135)', () => {
  const fileBytes = Deno.readFileSync(AGENTS_MD_URL);
  const size = fileBytes.byteLength;

  assert(
    size <= MAX_BYTES_CEILING,
    `AGENTS.md exceeds 12 KiB ceiling: current size is ${size} bytes (limit is ${MAX_BYTES_CEILING} bytes)`,
  );

  // Target size is 8–10 KiB; verify the file remains substantive.
  assert(
    size >= 6 * 1024,
    `AGENTS.md appears unusually small: current size is ${size} bytes`,
  );
});

Deno.test('agent docs: root AGENTS.md declares supported authoritative lifecycle status (#135)', () => {
  const content = Deno.readTextFileSync(AGENTS_MD_URL);
  const match = content.match(/### Current phase:\s*([^\n\r]+)/);
  assert(
    match !== null,
    'AGENTS.md must declare authoritative lifecycle status in "### Current phase: <PHASE>"',
  );
  const phase = match[1].trim();
  const validPhases = ['PRE-LAUNCH', 'LIVE'];
  assert(
    validPhases.includes(phase),
    `AGENTS.md declares unknown lifecycle phase "${phase}"; supported phases are: ${
      validPhases.join(', ')
    }`,
  );
  if (phase === 'PRE-LAUNCH') {
    assert(
      content.includes('Active now: pre-launch rules'),
      'AGENTS.md in PRE-LAUNCH phase must include "Active now: pre-launch rules"',
    );
  } else if (phase === 'LIVE') {
    assert(
      !content.includes('Active now: pre-launch rules'),
      'AGENTS.md in LIVE phase must not retain residual "Active now: pre-launch rules"',
    );
  }
});

Deno.test('agent docs: task-to-skill routing table matches repository skills (#135)', () => {
  const content = Deno.readTextFileSync(AGENTS_MD_URL);

  // Locate the task-to-skill routing section
  const sectionHeader = '## Task-to-skill routing';
  const sectionStart = content.indexOf(sectionHeader);
  assert(
    sectionStart !== -1,
    'Could not find "## Task-to-skill routing" section in AGENTS.md',
  );

  const afterHeader = content.slice(sectionStart + sectionHeader.length);
  const nextSectionIndex = afterHeader.indexOf('\n## ');
  const sectionContent = nextSectionIndex !== -1
    ? afterHeader.slice(0, nextSectionIndex)
    : afterHeader;

  // Reject legacy docs/agent-guides/ references
  assert(
    !sectionContent.includes('docs/agent-guides/'),
    'Routing table must not reference legacy "docs/agent-guides/" path',
  );

  // Extract all backtick-quoted file paths under .agents/skills/
  const pathMatches = Array.from(
    sectionContent.matchAll(/`(\.agents\/skills\/[^`]+\/SKILL\.md)`/g),
  );
  const routedPaths = pathMatches.map((m) => m[1]);

  assertEquals(
    routedPaths.length,
    EXPECTED_SKILLS.size,
    `Expected exactly ${EXPECTED_SKILLS.size} skill references in routing table, found ${routedPaths.length}`,
  );

  // Check for duplicate routes
  const uniquePaths = new Set(routedPaths);
  assertEquals(
    uniquePaths.size,
    routedPaths.length,
    'Routing table contains duplicate skill paths',
  );

  // Every referenced path must exist as a regular file
  for (const relPath of routedPaths) {
    const fileUrl = new URL(relPath, REPO_ROOT_URL);
    let stat: Deno.FileInfo;
    try {
      stat = Deno.lstatSync(fileUrl);
    } catch {
      throw new Error(`Skill referenced in AGENTS.md routing table does not exist: ${relPath}`);
    }
    assert(stat.isFile, `Path referenced in routing table is not a file: ${relPath}`);
  }

  // Bidirectional check: every directory in .agents/skills/ must be routed in AGENTS.md
  const skillDirsOnDisk: string[] = [];
  for (const entry of Deno.readDirSync(SKILLS_DIR_URL)) {
    if (entry.isDirectory) {
      skillDirsOnDisk.push(entry.name);
    }
  }

  const routedSkillNames = routedPaths.map((p) => {
    const parts = p.split('/');
    return parts[2]; // .agents / skills / <name> / SKILL.md
  });

  assertEquals(
    new Set(routedSkillNames),
    EXPECTED_SKILLS,
    'Set of routed skills in AGENTS.md does not match expected skills',
  );
  assertEquals(
    new Set(skillDirsOnDisk),
    EXPECTED_SKILLS,
    'Set of skill directories on disk does not match expected skills',
  );
});

Deno.test('agent docs: each skill has valid metadata and matches directory (#135)', () => {
  for (const entry of Deno.readDirSync(SKILLS_DIR_URL)) {
    if (!entry.isDirectory) continue;
    const dirName = entry.name;
    const skillMdUrl = new URL(`${dirName}/SKILL.md`, SKILLS_DIR_URL);

    let stat: Deno.FileInfo;
    try {
      stat = Deno.lstatSync(skillMdUrl);
    } catch {
      throw new Error(`Missing SKILL.md in skill directory: .agents/skills/${dirName}/`);
    }
    assert(stat.isFile, `.agents/skills/${dirName}/SKILL.md is not a file`);

    const text = Deno.readTextFileSync(skillMdUrl);
    const frontmatterMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
    assert(
      frontmatterMatch !== null,
      `.agents/skills/${dirName}/SKILL.md is missing YAML frontmatter enclosed by "---"`,
    );

    const parsed = parseYaml(frontmatterMatch[1]);
    assert(
      typeof parsed === 'object' && parsed !== null,
      `.agents/skills/${dirName}/SKILL.md frontmatter failed to parse as a YAML object`,
    );
    const { name, description } = parsed as Record<string, unknown>;

    assert(
      typeof name === 'string' && name.trim().length > 0,
      `.agents/skills/${dirName}/SKILL.md has missing or empty "name" in frontmatter`,
    );
    assertEquals(
      name,
      dirName,
      `Skill name "${name}" in frontmatter does not match directory name "${dirName}"`,
    );

    assert(
      typeof description === 'string' && description.trim().length > 0,
      `.agents/skills/${dirName}/SKILL.md has missing or empty "description" in frontmatter`,
    );
    assert(
      description.length >= 20,
      `.agents/skills/${dirName}/SKILL.md description is too short to clearly identify triggers (${description.length} chars)`,
    );
  }
});

Deno.test('agent docs: legacy docs/agent-guides directory does not exist (#135)', () => {
  const legacyDirUrl = new URL('../docs/agent-guides/', import.meta.url);
  let exists = false;
  try {
    Deno.lstatSync(legacyDirUrl);
    exists = true;
  } catch {
    exists = false;
  }
  assert(!exists, 'Legacy "docs/agent-guides/" directory must not exist');
});
