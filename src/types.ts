export type BlockKind =
  | 'heading'
  | 'paragraph'
  | 'listItem'
  | 'code'
  | 'blockquote'
  | 'tableRow'
  | 'thematicBreak'
  | 'html';

export interface SourceRange {
  startByte: number;
  endByte: number;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface MarkdownBlock {
  id: string;
  kind: BlockKind;
  astPath: number[];
  text: string;
  source: SourceRange;
  /** JavaScript string offsets used internally for safe source slicing. */
  startOffset: number;
  endOffset: number;
  exact: string;
}

export interface ReviewComment {
  id: string;
  blockId: string;
  body: string;
  createdAt: string;
}

export interface ReviewTarget {
  kind: BlockKind;
  astPath: number[];
  source: SourceRange;
  quote: {
    exact: string;
    prefix: string;
    suffix: string;
  };
  fingerprint: string;
}

export interface ReviewBundleComment {
  id: string;
  target: ReviewTarget;
  body: string;
  createdAt: string;
}

export interface ReviewBundle {
  schemaVersion: 'annoterm.markdown-review/v1';
  reviewId: string;
  state: 'submitted';
  file: {
    path: string;
    sha256: string;
    reviewedAt: string;
  };
  comments: ReviewBundleComment[];
  summary: {
    commentCount: number;
    targetCount: number;
  };
}

export interface PendingReview {
  schemaVersion: 'annoterm.markdown-review-draft/v1';
  reviewId: string;
  state: 'collecting';
  file: {
    path: string;
    sha256: string;
    source: string;
  };
  comments: ReviewComment[];
  updatedAt: string;
}
