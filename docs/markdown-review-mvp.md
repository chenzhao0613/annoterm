# Markdown Review MVP

- **Status:** Proposed current implementation scope
- **Scope:** One local Markdown file, terminal review, item-level comments, one batched handoff
- **Supersedes:** Milestone 1 of the broader [technical specification](technical-spec.md)

## 1. Product statement

The MVP lets an agent write a plan as a normal Markdown file and hand terminal control to a reviewer. The reviewer reads the rendered Markdown, focuses a specific item, presses `c`, records a thought, and continues reading. Comments remain pending until the reviewer chooses **Finish review**. The command then returns one structured feedback bundle to the agent, without requiring the reviewer to write another prompt or explain what each comment refers to.

```text
agent writes PLAN.md
       ↓
agent invokes Markdown review and waits
       ↓
user navigates rendered Markdown
       ↓
focus item → c → comment → save → continue
       ↓
Finish review
       ↓
agent receives one contextual JSON bundle and resumes
```

## 2. Can a terminal render Markdown?

Yes. Annoterm will parse Markdown into a syntax tree and translate it into styled terminal cells. It will not display browser typography, but it can render the document clearly and interactively:

- headings as bold, colored lines,
- emphasis, strong text, and strikethrough with terminal attributes,
- ordered/unordered lists with indentation and bullets,
- task-list checkboxes,
- wrapped paragraphs and block quotes,
- fenced code blocks with borders and optional syntax highlighting,
- tables with calculated columns and horizontal scrolling when needed,
- links as labeled text with the URL available in Inspect mode,
- images as their alt text and target path/URL,
- horizontal rules and document spacing.

Raw HTML is shown as escaped text or omitted according to configuration. Raw ANSI/control sequences are never passed through to the terminal.

Example:

```markdown
## Storage

1. Use SQLite for review state.
2. Keep every generated revision.
```

Possible terminal rendering:

```text
  STORAGE

  ▶ 1. Use SQLite for review state.                 💬 1
    2. Keep every generated revision.

  c comment   e comments   S finish review   ? help
```

The important capability is not visual styling alone. Each rendered block retains a mapping to its Markdown source range, which allows a comment to identify the exact list item or paragraph automatically.

## 3. MVP boundaries

### Included

- Open one UTF-8 Markdown file from the local filesystem.
- CommonMark plus a constrained set of GitHub Flavored Markdown extensions.
- Render inside an alternate-screen TUI.
- Keyboard navigation among semantic Markdown blocks.
- Block-level comments on headings, paragraphs, list items, task items, block quotes, code blocks, and table rows/cells where practical.
- Durable pending comments and crash recovery.
- Edit/delete pending comments.
- Submit all comments together with **Finish review**.
- Return a machine-readable bundle to a waiting agent.

### Deferred

- Generic artifact JSON and custom visual nodes.
- Comments on arbitrary character selections.
- Rendering several files as one review.
- Revision comparison and re-anchoring after the agent edits the file.
- Daemon, protocol server, SQLite event log, cloud sync, or multi-user review.
- Images, Mermaid execution, embedded HTML, or executable controls.
- Agent replies and addressed/resolved feedback threads.

These features remain in the broader design but should not delay validation of the core interaction.

## 4. Invocation and handoff

### 4.1 Standalone/agent invocation

```sh
annoterm review PLAN.md --format json
```

The process reads and hashes `PLAN.md`, opens the TUI on the controlling terminal, and blocks while the human reviews. On **Finish review**, it closes the TUI and writes exactly one JSON `ReviewBundle` to stdout. The invoking agent receives that result and continues its existing turn.

To keep machine output clean:

- the interactive TUI reads/writes through the controlling terminal,
- stdout is reserved for the final bundle when `--format json` is used,
- diagnostics go to stderr after leaving alternate-screen mode,
- cancellation has a distinct exit code and never produces a partial submitted bundle.

Optional file output supports hosts that cannot capture stdout:

```sh
annoterm review PLAN.md --output .annoterm/completed/review.json
```

### 4.2 Host integration

The preferred host behavior is a blocking interactive review call:

```text
write PLAN.md → call annoterm review → yield terminal to user → receive ReviewBundle
```

If an agent host cannot attach an interactive child process to its terminal, it can run `annoterm feedback wait` while the reviewer launches `annoterm review` separately. A thin native host extension may invoke the same CLI contract as a convenience, but the CLI and persisted bundles remain authoritative. Protocol servers and resident daemons are unnecessary.

## 5. TUI interaction

### 5.1 Layout

```text
┌ PLAN.md · REVIEWING · 2 pending ───────────────────────────────────┐
│ # Implementation plan                                             │
│                                                                    │
│   1. Create the schema                                             │
│ ▶ 2. Add SQLite persistence                                 💬 1  │
│      Use WAL mode and a workspace database.                        │
│   3. Implement the renderer                                        │
│                                                                    │
├ target: list item 2 · lines 8–9 ───────────────────────────────────┤
│ c comment · e comments · S finish · q save & exit · ? help         │
└────────────────────────────────────────────────────────────────────┘
```

The focused block is visually distinct without relying only on color. Pending comment counts appear in the gutter. Narrow terminals replace the metadata row with an overlay.

### 5.2 Navigation

| Key | Action |
|---|---|
| `j` / `k` or arrows | Next/previous semantic block |
| `Tab` / `Shift-Tab` | Next/previous annotatable block |
| `h` / `l` | Parent/first child for nested lists and sections |
| `g` / `G` | First/last block |
| `Enter` | Inspect target source and existing comments |
| `c` | Open quick-comment composer for focused block |
| `e` | Open pending-comment list/editor |
| `S` | Review and submit the complete batch |
| `q` | Save pending review and exit without submitting |
| `?` | Help |

### 5.3 Quick-comment composer

- Opens at the bottom of the current screen; the target remains visible and highlighted.
- Shows a non-editable target preview and source line range.
- The user enters only the comment, not a quotation or item number.
- `Ctrl-S` saves the comment and returns immediately to document navigation.
- `Esc` closes an empty composer or offers to keep a non-empty draft.
- Draft content is persisted after each edit debounce and before terminal resize/exit.
- More than one comment may target the same block.

### 5.4 Finish review

Pressing `S` opens a compact summary:

```text
Finish review?

3 comments on 2 items
  line 8   Add SQLite persistence       2 comments
  line 19  Error handling               1 comment

[Enter] Submit to agent   [Esc] Continue reviewing
```

Submission is atomic. All pending comments become part of one ordered bundle, the draft is marked submitted, terminal state is restored, and the bundle is returned. There is no editable “final prompt” screen.

## 6. Markdown parsing and rendering

### 6.1 Parser

Use a CommonMark-compliant parser with source positions, preferably `comrak` in the Rust implementation. Enable only documented GFM extensions:

- tables,
- task lists,
- strikethrough,
- autolinks.

The parser must expose start/end source positions or byte offsets for semantic nodes. If parser source positions are line/column only, Annoterm builds a line index to map them to UTF-8 byte offsets.

### 6.2 Semantic focus units

The focus tree is derived from Markdown AST nodes, not rendered terminal lines.

Primary focus units:

- heading,
- paragraph,
- list item as a whole,
- fenced/indented code block,
- block quote,
- table row, with cells optionally focusable,
- thematic break only when explicitly enabled.

Inline emphasis and individual wrapped visual lines are not separate focus units in the MVP. Links are inspectable from their containing block. A list item's marker, checkbox, first paragraph, and nested blocks remain associated with the list item target.

### 6.3 Source map

Layout produces both terminal cells and a source map:

```text
Markdown AST node
  → source byte range and line/column range
  → rendered rectangles/cells
  → focus target
```

Wrapping or scrolling changes rendered rectangles but never the persisted source anchor. The TUI can therefore show a focus highlight while the output bundle refers to stable source context.

### 6.4 Rendering degradation

- Unsupported inline constructs fall back to readable plain text.
- Oversized tables use horizontal scrolling before destructive truncation.
- Images render as `[image: ALT] (TARGET)` without fetching data.
- Mermaid and other fenced languages render as code only.
- Color is optional; focus and hierarchy also use borders, markers, spacing, and attributes.
- Unicode bullets/borders have ASCII fallbacks.

## 7. Comment anchors

The review operates on an immutable snapshot, so MVP anchors can be conservative and simple.

Each target records:

- canonical or workspace-relative file path,
- SHA-256 of the complete reviewed file,
- Markdown node kind,
- AST child-index path,
- start/end UTF-8 byte offset,
- start/end line and column,
- exact source text,
- short prefix/suffix context,
- hash of normalized target text.

The source line range helps the agent and human read the bundle. Byte offsets and exact/context text provide unambiguous machine targeting. The AST path is supplementary and must not be the only anchor because sibling insertion can change it.

If `PLAN.md` changes externally while review is open, Annoterm keeps rendering the captured snapshot and shows a warning. The reviewer may:

1. continue and submit against the original hash,
2. abandon pending comments and reload, or
3. attempt a conservative same-text reload only if every target has one unique match.

The MVP never silently moves a comment after a file change.

## 8. Review bundle

```json
{
  "schemaVersion": "annoterm.markdown-review/v1",
  "reviewId": "review_01J...",
  "state": "submitted",
  "file": {
    "path": "PLAN.md",
    "sha256": "sha256:...",
    "reviewedAt": "2026-01-15T19:20:31Z"
  },
  "comments": [
    {
      "id": "comment_01J...",
      "target": {
        "kind": "listItem",
        "astPath": [0, 3, 1],
        "source": {
          "startByte": 142,
          "endByte": 203,
          "startLine": 8,
          "startColumn": 1,
          "endLine": 9,
          "endColumn": 42
        },
        "quote": {
          "exact": "2. Add SQLite persistence\n   Use WAL mode...",
          "prefix": "1. Create the schema\n",
          "suffix": "3. Implement the renderer\n"
        },
        "fingerprint": "sha256:..."
      },
      "body": "Do we need SQLite yet? A JSON draft file may be enough for this MVP.",
      "createdAt": "2026-01-15T19:22:10Z"
    }
  ],
  "summary": {
    "commentCount": 1,
    "targetCount": 1
  }
}
```

Comments are ordered first by source position and then by creation time. The agent should treat the file hash as an optimistic-concurrency guard and verify it before editing.

## 9. Draft persistence

Use simple atomic JSON files rather than SQLite for the MVP:

```text
.annoterm/
  reviews/
    review_01J....pending.json
    review_01J....submitted.json
```

A draft contains the reviewed source snapshot or a content-addressed reference, pending comments, composer draft, focus target, and scroll position. Writes go to a temporary file, are flushed, and are atomically renamed. `q` exits without submission and prints a resume command:

```sh
annoterm review --resume review_01J...
```

Submitted drafts can be pruned manually. Automatic retention policy is deferred.

## 10. Safety

- Validate UTF-8 and impose configurable file/comment size limits.
- Replace terminal control characters before measurement or rendering.
- Do not interpret raw HTML, links, image targets, or code blocks as commands.
- Do not fetch network resources.
- Restore terminal state on normal exit, signal, and panic.
- Never place TUI escape output in the final JSON stream.

## 11. Recommended implementation shape

One Rust binary and a small set of modules are sufficient:

```text
src/
  markdown.rs     parse AST, source positions, semantic focus tree
  render.rs       layout, wrapping, terminal cells, source hit map
  review.rs       review state machine, comments, batch submission
  draft.rs        atomic draft persistence and recovery
  tui.rs          input modes, composer, navigation, terminal lifecycle
  protocol.rs     ReviewBundle types and JSON serialization
  main.rs         CLI and controlling-terminal handoff
```

Recommended libraries:

- `ratatui` and `crossterm`,
- `comrak`,
- `serde` / `serde_json`,
- `sha2`,
- `unicode-width` and Unicode segmentation support.

Do not create the broader multi-crate architecture until this interaction validates the product.

## 12. Delivery slices

### Slice 1: Readable Markdown

- Open a file and parse CommonMark/GFM.
- Render headings, paragraphs, lists, code, quotes, and tables.
- Navigate semantic focus units and show source lines.
- Test at 40×12, 80×24, and 120×40.

**Exit:** A real agent-generated `PLAN.md` is comfortable to read and every plan item is reachable.

### Slice 2: Immediate contextual comments

- Add quick composer, block anchors, badges, edit/delete, and autosaved drafts.
- Detect external file changes.
- Add review summary and atomic **Finish review**.

**Exit:** The user can record several thoughts without leaving the document or restating any target.

### Slice 3: Agent handoff

- Reserve stdout for `ReviewBundle` JSON.
- Add blocking invocation, cancellation, resume, and output-file fallback.
- Build one host adapter if interactive subprocess handoff is unavailable.

**Exit:** The agent writes a plan, waits during review, receives the batch, and continues without a new user prompt.

## 13. MVP acceptance criteria

1. `annoterm review PLAN.md --format json` renders a representative Markdown plan in the current terminal.
2. Every heading, paragraph, list item, and code block is keyboard reachable.
3. Pressing `c` opens a composer while the target remains visible.
4. Saving a comment takes the user directly back to reading and displays a pending badge.
5. The user never manually enters a file path, line number, item number, or quotation in the comment.
6. Several comments can be edited and are not exposed as submitted feedback before **Finish review**.
7. Exiting or crashing preserves pending comments and permits resume.
8. **Finish review** returns one valid JSON bundle containing every comment and its exact source context.
9. The TUI restores the terminal and emits no escape bytes into machine JSON.
10. The waiting agent can use the returned bundle without asking the user to create another prompt.

## 14. Settled decisions

- The first artifact format is a normal Markdown file.
- Feedback is block/item-level before arbitrary text-range selection.
- Comments are persisted immediately but delivered as a batch only after **Finish review**.
- The CLI is the primary integration contract: TUI on the controlling terminal, diagnostics on stderr, feedback on stdout.
- Agents that cannot own the interactive process can use `annoterm feedback latest/list/wait`.
- Host-specific integrations are optional CLI adapters; there is no protocol-server dependency.
- Draft persistence uses atomic JSON files before introducing SQLite.
- The broader structured-artifact system remains a future direction, not an MVP dependency.
