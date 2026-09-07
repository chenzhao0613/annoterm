import type {ReviewBundle} from './types.js';

export function feedbackPrompt(bundle: ReviewBundle): string {
  const lines = [
    '## Markdown review feedback',
    `Reviewed file: \`${bundle.file.path}\``,
    `Reviewed SHA-256: \`${bundle.file.sha256}\``,
    '',
  ];

  if (bundle.comments.length === 0) {
    lines.push('The review was completed with no comments. Continue with the plan as written.');
  } else {
    for (const [index, comment] of bundle.comments.entries()) {
      const source = comment.target.source;
      const quote = comment.target.quote.exact.trim();
      lines.push(
        `### Comment ${index + 1} - lines ${source.startLine}–${source.endLine}`,
        '',
        `> ${quote.replace(/\n/g, '\n> ')}`,
        '',
        comment.body,
        '',
      );
    }
    lines.push(
      'Apply this feedback to the plan/file. Preserve the intent of uncommented items and report how each comment was addressed.',
    );
  }

  return lines.join('\n');
}
