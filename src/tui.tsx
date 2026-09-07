import {useMemo, useState} from 'react';
import {Box, Text, useApp, useInput, useStdout} from 'ink';
import {randomUUID} from 'node:crypto';
import {Marked} from 'marked';
import {markedTerminal} from 'marked-terminal';
import sliceAnsi from 'slice-ansi';
import stringWidth from 'string-width';
import type {MarkdownBlock, ReviewComment} from './types.js';

type Mode = 'browse' | 'comment' | 'comments' | 'summary' | 'help';

type ReviewAppProps = {
  fileName: string;
  blocks: MarkdownBlock[];
  onCommentsChanged: (comments: ReviewComment[]) => void;
  onSubmit: (comments: ReviewComment[]) => void;
  onCancel: () => void;
};

type VisualLine = {blockIndex: number; text: string; first: boolean};

function hardSlice(value: string, width: number): string {
  if (width <= 0) return '';
  if (stringWidth(value) <= width) return value;
  if (width === 1) return '…';
  return `${sliceAnsi(value, 0, width - 1)}…`;
}

function safeMarkdown(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '�');
}

function renderMarkdownBlock(block: MarkdownBlock, width: number): string[] {
  if (block.kind === 'tableRow') return [`│ ${block.text} │`];
  if (block.kind === 'thematicBreak') return ['─'.repeat(Math.max(1, width))];

  const terminalExtension = markedTerminal({
    width: Math.max(16, width),
    reflowText: true,
    showSectionPrefix: false,
    unescape: false,
    emoji: true,
    tab: 2,
  });
  const parser = new Marked(terminalExtension);
  const rendered = String(parser.parse(safeMarkdown(block.exact))).replace(/^\n+|\n+$/g, '');
  const lines = rendered ? rendered.split('\n') : [block.text || '(empty block)'];
  return lines.map(line => hardSlice(line.replace(/\s+$/g, ''), width));
}

function blockLines(block: MarkdownBlock, width: number, commentCount: number): string[] {
  const badge = commentCount > 0 ? `  [${commentCount} comment${commentCount === 1 ? '' : 's'}]` : '';
  const lines = renderMarkdownBlock(block, Math.max(16, width - badge.length));
  lines[0] = `${hardSlice(lines[0] ?? '', Math.max(1, width - stringWidth(badge)))}${badge}`;
  if (block.kind === 'heading') lines.push('');
  return lines;
}

function Header({fileName, comments, width}: {fileName: string; comments: number; width: number}) {
  const title = ` ${fileName} · REVIEWING · ${comments} pending `;
  return <Text bold color="cyan">{hardSlice(`${title}${'─'.repeat(Math.max(0, width - title.length))}`, width)}</Text>;
}

export function ReviewApp({
  fileName,
  blocks,
  onCommentsChanged,
  onSubmit,
  onCancel,
}: ReviewAppProps) {
  const {exit} = useApp();
  const {stdout} = useStdout();
  const width = Math.max(40, stdout.columns ?? 80);
  const height = Math.max(12, stdout.rows ?? 24);
  const [focus, setFocus] = useState(0);
  const [mode, setMode] = useState<Mode>('browse');
  const [draft, setDraft] = useState('');
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [commentFocus, setCommentFocus] = useState(0);
  const focusedBlock = blocks[focus];

  const counts = useMemo(() => {
    const value = new Map<string, number>();
    for (const comment of comments) value.set(comment.blockId, (value.get(comment.blockId) ?? 0) + 1);
    return value;
  }, [comments]);

  const visualLines = useMemo<VisualLine[]>(() => {
    return blocks.flatMap((block, blockIndex) =>
      blockLines(block, width - 4, counts.get(block.id) ?? 0).map((text, index) => ({blockIndex, text, first: index === 0})),
    );
  }, [blocks, counts, width]);

  const persist = (next: ReviewComment[]) => {
    setComments(next);
    onCommentsChanged(next);
  };

  const saveComment = () => {
    const body = draft.trim();
    if (!body || !focusedBlock) return;
    const next = [
      ...comments,
      {
        id: `comment_${randomUUID()}`,
        blockId: focusedBlock.id,
        body,
        createdAt: new Date().toISOString(),
      },
    ];
    persist(next);
    setDraft('');
    setMode('browse');
  };

  useInput((input, key) => {
    if (mode === 'comment') {
      if (key.escape) {
        setMode('browse');
        return;
      }
      if (key.return || (key.ctrl && input.toLowerCase() === 's')) {
        saveComment();
        return;
      }
      if (key.backspace || key.delete) {
        setDraft(value => value.slice(0, -1));
        return;
      }
      if (!key.ctrl && !key.meta && input) setDraft(value => value + input.replace(/[\r\n]/g, ' '));
      return;
    }

    if (mode === 'help') {
      if (key.escape || input === '?') setMode('browse');
      return;
    }

    if (mode === 'summary') {
      if (key.escape) setMode('browse');
      else if (key.return) {
        onSubmit(comments);
        exit();
      }
      return;
    }

    if (mode === 'comments') {
      if (key.escape || input === 'e') {
        setMode('browse');
        return;
      }
      if (key.upArrow || input === 'k') setCommentFocus(value => Math.max(0, value - 1));
      if (key.downArrow || input === 'j') setCommentFocus(value => Math.min(Math.max(0, comments.length - 1), value + 1));
      if (input === 'd' && comments[commentFocus]) {
        const next = comments.filter((_, index) => index !== commentFocus);
        persist(next);
        setCommentFocus(value => Math.min(value, Math.max(0, next.length - 1)));
      }
      return;
    }

    if (key.upArrow || input === 'k') setFocus(value => Math.max(0, value - 1));
    else if (key.downArrow || input === 'j' || key.tab) setFocus(value => Math.min(blocks.length - 1, value + 1));
    else if (input === 'g') setFocus(0);
    else if (input === 'G') setFocus(Math.max(0, blocks.length - 1));
    else if (input === 'c' && focusedBlock) {
      setDraft('');
      setMode('comment');
    } else if (input === 'e') {
      setCommentFocus(0);
      setMode('comments');
    } else if (input === 'S') setMode('summary');
    else if (input === '?') setMode('help');
    else if (input === 'q') {
      onCancel();
      exit();
    }
  });

  if (mode === 'help') {
    return (
      <Box flexDirection="column" width={width}>
        <Header fileName={fileName} comments={comments.length} width={width} />
        <Box borderStyle="round" borderColor="cyan" flexDirection="column" paddingX={1} marginTop={1}>
          <Text bold>Markdown review keys</Text>
          <Text>j/k or arrows   previous/next block</Text>
          <Text>g/G             first/last block</Text>
          <Text>c               comment on focused block</Text>
          <Text>e               inspect/delete comments</Text>
          <Text>S               finish and submit batch</Text>
          <Text>q               save without submitting</Text>
          <Text> </Text>
          <Text dimColor>Esc or ? returns to the document</Text>
        </Box>
      </Box>
    );
  }

  if (mode === 'summary') {
    const targets = counts.size;
    return (
      <Box flexDirection="column" width={width}>
        <Header fileName={fileName} comments={comments.length} width={width} />
        <Box borderStyle="round" borderColor="cyan" flexDirection="column" paddingX={1} marginTop={1}>
          <Text bold>Finish review?</Text>
          <Text>{`${comments.length} comment${comments.length === 1 ? '' : 's'} on ${targets} item${targets === 1 ? '' : 's'}`}</Text>
          <Text> </Text>
          {comments.slice(0, Math.max(1, height - 9)).map(comment => {
            const block = blocks.find(candidate => candidate.id === comment.blockId);
            return <Text key={comment.id}>{`line ${block?.source.startLine ?? '?'} · ${hardSlice(block?.text ?? '', 28)} - ${hardSlice(comment.body, Math.max(12, width - 48))}`}</Text>;
          })}
          <Text> </Text>
          <Text color="green">Enter submit to agent</Text>
          <Text dimColor>Esc continue reviewing</Text>
        </Box>
      </Box>
    );
  }

  if (mode === 'comments') {
    return (
      <Box flexDirection="column" width={width}>
        <Header fileName={fileName} comments={comments.length} width={width} />
        <Text bold>Pending comments</Text>
        {comments.length === 0 ? <Text dimColor>No comments yet. Press Esc to return.</Text> : comments.slice(0, height - 5).map((comment, index) => {
          const block = blocks.find(candidate => candidate.id === comment.blockId);
          return <Text key={comment.id} inverse={index === commentFocus}>{`${index === commentFocus ? '▶' : ' '} line ${block?.source.startLine ?? '?'} · ${hardSlice(comment.body, width - 16)}`}</Text>;
        })}
        <Text dimColor>j/k move · d delete · Esc return</Text>
      </Box>
    );
  }

  const contentRows = Math.max(4, height - (mode === 'comment' ? 8 : 5));
  const focusedLine = Math.max(0, visualLines.findIndex(line => line.blockIndex === focus));
  const scrollTop = Math.max(0, Math.min(visualLines.length - contentRows, focusedLine - Math.floor(contentRows / 2)));
  const visible = visualLines.slice(scrollTop, scrollTop + contentRows);

  return (
    <Box flexDirection="column" width={width}>
      <Header fileName={fileName} comments={comments.length} width={width} />
      <Box flexDirection="column" height={contentRows} paddingX={1}>
        {visible.map((line, index) => {
          const block = blocks[line.blockIndex];
          const selected = line.blockIndex === focus;
          return (
            <Text
              key={`${scrollTop + index}:${block.id}`}
              inverse={selected}
              bold={block.kind === 'heading'}
              color={block.kind === 'heading' ? 'cyan' : block.kind === 'code' ? 'green' : undefined}
            >
              {`${selected && line.first ? '▶ ' : '  '}${hardSlice(line.text, width - 4)}`}
            </Text>
          );
        })}
      </Box>
      <Text dimColor>{focusedBlock ? ` ${focusedBlock.kind} · lines ${focusedBlock.source.startLine}–${focusedBlock.source.endLine}` : ' No Markdown blocks found'}</Text>
      {mode === 'comment' ? (
        <Box borderStyle="round" borderColor="yellow" flexDirection="column" paddingX={1}>
          <Text dimColor>{`Comment on line ${focusedBlock?.source.startLine}: ${hardSlice(focusedBlock?.text ?? '', width - 28)}`}</Text>
          <Text>{`> ${hardSlice(draft, width - 6)}█`}</Text>
          <Text dimColor>Enter/Ctrl-S save · Esc cancel</Text>
        </Box>
      ) : (
        <Text> j/k navigate · c comment · e comments · S finish · q save & exit · ? help</Text>
      )}
    </Box>
  );
}
