import { fromMarkdown } from 'mdast-util-from-markdown';
import { toString } from 'mdast-util-to-string';
import GithubSlugger from 'github-slugger';

type MarkdownRoot = ReturnType<typeof fromMarkdown>;
type MarkdownNode = MarkdownRoot | MarkdownRoot['children'][number];

/** Index rendered navigation and GitHub heading IDs, excluding metadata, code, and images. */
export function markdownNavigation(source: string): { links: string[]; anchors: Set<string> } {
  const body = source.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '');
  const nodes = [...markdownNodes(fromMarkdown(body))];
  const definitions = new Map<string, string>();
  for (const node of nodes) {
    if (node.type === 'definition' && !definitions.has(node.identifier)) {
      definitions.set(node.identifier, node.url);
    }
  }

  const slugger = new GithubSlugger();
  const anchors = new Set<string>();
  const links: string[] = [];
  for (const node of nodes) {
    if (node.type === 'heading') {
      anchors.add(slugger.slug(toString(node, { includeHtml: false })));
    } else if (node.type === 'link') {
      links.push(node.url);
    } else if (node.type === 'linkReference') {
      const destination = definitions.get(node.identifier);
      if (destination !== undefined) links.push(destination);
    }
  }
  return { links, anchors };
}

/** Preserve document order so repeated headings receive the same suffixes as their renderer. */
function* markdownNodes(node: MarkdownNode): Generator<MarkdownNode> {
  yield node;
  if ('children' in node) {
    for (const child of node.children) yield* markdownNodes(child);
  }
}

/** Check local paths and heading fragments; remote URLs are outside this offline guard. */
export async function validateMarkdownLinks(
  document: URL,
  readText: (path: URL) => Promise<string> = Deno.readTextFile,
): Promise<void> {
  const navigation = markdownNavigation(await readText(document));
  for (const target of navigation.links) {
    let destination: URL;
    let fragment: string;
    try {
      destination = new URL(target, document);
      if (destination.protocol !== 'file:' || destination.host) continue;
      fragment = decodeURIComponent(destination.hash.slice(1));
    } catch (error) {
      throw new Error(`${document.pathname}: malformed reference ${target}`, { cause: error });
    }
    destination.hash = '';
    destination.search = '';
    let source: string;
    try {
      source = await readText(destination);
    } catch (error) {
      throw new Error(`${document.pathname}: broken local reference ${target}`, { cause: error });
    }
    if (fragment && !markdownNavigation(source).anchors.has(fragment)) {
      throw new Error(`${document.pathname}: missing heading in local reference ${target}`);
    }
  }
}
