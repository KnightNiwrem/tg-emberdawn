import { assert } from '@std/assert';

const AGENTS_MD_URL = new URL('../AGENTS.md', import.meta.url);
const REPO_ROOT_URL = new URL('../', import.meta.url);
const MAX_BYTES_CEILING = 12 * 1024; // 12 KiB

Deno.test('agent docs: root AGENTS.md size does not exceed 12 KiB ceiling (#135)', () => {
  const fileBytes = Deno.readFileSync(AGENTS_MD_URL);
  const size = fileBytes.byteLength;

  assert(
    size <= MAX_BYTES_CEILING,
    `AGENTS.md exceeds 12 KiB ceiling: current size is ${size} bytes (limit is ${MAX_BYTES_CEILING} bytes)`,
  );

  // Target size is 8–10 KiB; verify the file remains substantive and not accidentally emptied.
  assert(
    size >= 6 * 1024,
    `AGENTS.md appears unusually small: current size is ${size} bytes`,
  );
});

Deno.test('agent docs: every path in the task-to-guide routing table exists (#135)', () => {
  const content = Deno.readTextFileSync(AGENTS_MD_URL);

  // Locate the task-to-guide routing section
  const sectionHeader = '## Task-to-guide routing';
  const sectionStart = content.indexOf(sectionHeader);
  assert(
    sectionStart !== -1,
    'Could not find "## Task-to-guide routing" section in AGENTS.md',
  );

  // Take the content following the header up to the next section header
  const afterHeader = content.slice(sectionStart + sectionHeader.length);
  const nextSectionIndex = afterHeader.indexOf('\n## ');
  const sectionContent = nextSectionIndex !== -1
    ? afterHeader.slice(0, nextSectionIndex)
    : afterHeader;

  // Extract all backtick-quoted file paths under docs/
  const pathMatches = Array.from(sectionContent.matchAll(/`((?:docs\/)[^`]+)`/g));
  const referencedPaths = pathMatches.map((m) => m[1]);

  assert(
    referencedPaths.length >= 7,
    `Expected at least 7 guide references in routing table, found ${referencedPaths.length}`,
  );

  for (const relPath of referencedPaths) {
    const fileUrl = new URL(relPath, REPO_ROOT_URL);
    try {
      const stat = Deno.statSync(fileUrl);
      assert(stat.isFile, `Path referenced in routing table is not a file: ${relPath}`);
    } catch {
      throw new Error(
        `Path referenced in AGENTS.md routing table does not exist: ${relPath}`,
      );
    }
  }
});

Deno.test('agent docs: all canonical docs/agent-guides files exist and are populated (#135)', () => {
  const requiredGuides = [
    'docs/agent-guides/architecture.md',
    'docs/agent-guides/story-and-quests.md',
    'docs/agent-guides/combat.md',
    'docs/agent-guides/persistence.md',
    'docs/agent-guides/content-authoring.md',
    'docs/agent-guides/release.md',
    'docs/agent-guides/design-decisions.md',
    'docs/narrative-guide.md',
  ];

  for (const relPath of requiredGuides) {
    const fileUrl = new URL(relPath, REPO_ROOT_URL);
    const content = Deno.readTextFileSync(fileUrl);
    assert(
      content.length > 500,
      `Guide file ${relPath} is missing or too short (${content.length} chars)`,
    );
  }
});

Deno.test('agent docs: root AGENTS.md declares PRE-LAUNCH authoritative status (#135)', () => {
  const content = Deno.readTextFileSync(AGENTS_MD_URL);
  assert(
    content.includes('Current phase: PRE-LAUNCH'),
    'AGENTS.md must declare authoritative status "Current phase: PRE-LAUNCH"',
  );
});
