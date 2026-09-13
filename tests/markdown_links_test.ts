import { assertEquals, assertRejects } from '@std/assert';
import { markdownNavigation, validateMarkdownLinks } from './helpers_markdown.ts';

Deno.test('Markdown navigation excludes metadata, code, and images but resolves reference links', () => {
  const navigation = markdownNavigation([
    '---',
    'description: "[metadata](missing-metadata.md)"',
    '---',
    '# Guide',
    '```md',
    '# Not a heading',
    '[example](missing-fenced.md)',
    '```',
    '    [indented example](missing-indented.md)',
    '',
    '`[inline example](missing-inline.md)`',
    '![image](missing-image.png)',
    '[direct](guide.md#section "Title") and [reference][section]',
    '',
    '[section]: other.md#target',
    '[unused]: missing-unused.md',
  ].join('\n'));
  assertEquals(navigation.links, ['guide.md#section', 'other.md#target']);
  assertEquals([...navigation.anchors], ['guide']);
});

Deno.test('Markdown headings use rendered text, duplicate suffixes, and Unicode anchors', () => {
  const navigation = markdownNavigation([
    '# Hello, *World*!',
    '## Hello, **World**!',
    '## `Call()` &amp; <em>Café</em>',
    'Setext heading',
    '--------------',
    '# 中文',
  ].join('\n'));
  assertEquals([...navigation.anchors], [
    'hello-world',
    'hello-world-1',
    'call--café',
    'setext-heading',
    '中文',
  ]);
});

Deno.test('Markdown links validate paths, local fragments, and decoded destination fragments', async () => {
  const document = new URL('file:///guidance/skill.md');
  const sources = new Map([
    [
      document.href,
      '# Local\n[here](#local) [file](reference.md) [section](reference.md#caf%C3%A9-1)',
    ],
    ['file:///guidance/reference.md', '# Café\n## Café'],
  ]);
  await validateMarkdownLinks(document, (path) => {
    const source = sources.get(path.href);
    if (source === undefined) throw new Error(`Unexpected read: ${path.href}`);
    return Promise.resolve(source);
  });
});

Deno.test('Markdown links reject missing files and missing headings in either document', async () => {
  const document = new URL('file:///guidance/skill.md');
  for (
    const [target, message] of [
      ['missing.md', 'broken local reference missing.md'],
      ['reference.md#renamed', 'missing heading in local reference reference.md#renamed'],
      ['#renamed', 'missing heading in local reference #renamed'],
    ]
  ) {
    await assertRejects(
      () =>
        validateMarkdownLinks(document, (path) => {
          if (path.href === document.href) return Promise.resolve(`# Local\n[link](${target})`);
          if (path.pathname.endsWith('/reference.md')) return Promise.resolve('# Original');
          throw new Deno.errors.NotFound();
        }),
      Error,
      message,
    );
  }
});

Deno.test('Markdown links do not fetch external destinations', async () => {
  const document = new URL('file:///guidance/skill.md');
  await validateMarkdownLinks(document, (path) => {
    assertEquals(path, document, 'only the source document should be read');
    return Promise.resolve(
      '[web](https://example.com/guide) [mail](mailto:test@example.com) [relative](//example.com/guide)',
    );
  });
});
