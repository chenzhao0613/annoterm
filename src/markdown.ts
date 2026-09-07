import {unified} from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type {BlockKind, MarkdownBlock, SourceRange} from './types.js';

type Position = {
  start: {line: number; column: number; offset: number};
  end: {line: number; column: number; offset: number};
};

type AstNode = {
  type: string;
  value?: string;
  alt?: string;
  url?: string;
  depth?: number;
  checked?: boolean | null;
  children?: AstNode[];
  position?: Position;
};

function sourceLocation(
  node: AstNode,
  source: string,
): {range: SourceRange; startOffset: number; endOffset: number} {
  const position = node.position!;
  const startOffset = position.start.offset;
  const endOffset = Math.min(source.length, position.end.offset);
  return {
    range: {
      startByte: Buffer.byteLength(source.slice(0, startOffset), 'utf8'),
      endByte: Buffer.byteLength(source.slice(0, endOffset), 'utf8'),
      startLine: position.start.line,
      startColumn: position.start.column,
      endLine: position.end.line,
      endColumn: position.end.column,
    },
    startOffset,
    endOffset,
  };
}

function plainText(node: AstNode): string {
  switch (node.type) {
    case 'text':
    case 'inlineCode':
    case 'code':
    case 'html':
      return node.value ?? '';
    case 'image':
      return `[image: ${node.alt || 'untitled'}]${node.url ? ` (${node.url})` : ''}`;
    case 'break':
      return '\n';
    default:
      return (node.children ?? []).map(plainText).join('');
  }
}

function directListItemText(node: AstNode): string {
  const chunks: string[] = [];
  for (const child of node.children ?? []) {
    if (child.type === 'list') continue;
    const value = plainText(child).trim();
    if (value) chunks.push(value);
  }
  return chunks.join(' — ');
}

export function parseMarkdown(source: string): MarkdownBlock[] {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(source) as AstNode;
  const blocks: MarkdownBlock[] = [];

  const add = (
    node: AstNode,
    kind: BlockKind,
    path: number[],
    text: string,
  ) => {
    const {range, startOffset, endOffset} = sourceLocation(node, source);
    blocks.push({
      id: `${kind}:${range.startByte}:${range.endByte}`,
      kind,
      astPath: path,
      text: text.trimEnd(),
      source: range,
      startOffset,
      endOffset,
      exact: source.slice(startOffset, endOffset),
    });
  };

  const walk = (node: AstNode, path: number[]): void => {
    switch (node.type) {
      case 'root':
        (node.children ?? []).forEach((child, index) => walk(child, [...path, index]));
        return;
      case 'heading':
        add(node, 'heading', path, plainText(node));
        return;
      case 'paragraph':
        add(node, 'paragraph', path, plainText(node));
        return;
      case 'list': {
        (node.children ?? []).forEach((item, index) => {
          const checked = item.checked == null ? '' : item.checked ? '[x] ' : '[ ] ';
          add(item, 'listItem', [...path, index], `${checked}${directListItemText(item)}`);
          (item.children ?? []).forEach((child, childIndex) => {
            if (child.type === 'list') walk(child, [...path, index, childIndex]);
          });
        });
        return;
      }
      case 'code':
        add(node, 'code', path, node.value ?? '');
        return;
      case 'blockquote':
        add(node, 'blockquote', path, plainText(node));
        return;
      case 'table':
        (node.children ?? []).forEach((row, index) => {
          const cells = (row.children ?? []).map(cell => plainText(cell).trim());
          add(row, 'tableRow', [...path, index], cells.join(' │ '));
        });
        return;
      case 'thematicBreak':
        add(node, 'thematicBreak', path, '────────────────────────');
        return;
      case 'html':
        add(node, 'html', path, node.value ?? '');
        return;
      default:
        (node.children ?? []).forEach((child, index) => walk(child, [...path, index]));
    }
  };

  walk(tree, []);
  return blocks;
}
