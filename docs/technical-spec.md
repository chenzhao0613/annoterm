# Terminal Artifact System: Technical Specification

- **Working name:** Terminal Artifact System (TAS)
- **CLI name:** `tas`
- **Status:** Proposal for review
- **Implementation status:** Not started

> **Scope update:** The first implementation is intentionally limited to rendering and reviewing one normal Markdown file, then returning comments as a batch. See [Markdown Review MVP](markdown-review-mvp.md). The generalized artifact system below is retained as the future architecture and should not be built before the focused interaction is validated.

## 1. Summary

TAS is a local-first, terminal-native feedback environment for structured artifacts produced by an AI coding agent. The agent publishes a declarative artifact document. A human opens the artifact in a keyboard-driven TUI, moves focus among semantic elements, and attaches comments to an element or a precise subrange. The agent retrieves those comments as structured data, updates the artifact, and publishes a new immutable revision. TAS preserves feedback across revisions and lets the human verify or reopen proposed fixes.

The first and most important use case is reviewing an agent-generated plan without opening a new prompt. When the user notices an issue, they focus that exact plan item, press one key, write only the thought, save it, and continue reading. TAS automatically carries the item identity, quoted context, plan revision, and review state back to the waiting agent.

The initial system has no browser UI, webview, cloud service, protocol server, or executable artifact code. The TUI, CLI, and persistence layer ship as one local binary; host-specific integrations are optional wrappers around the CLI contract.

## 2. Goals

1. Render agent-generated, structured visual artifacts inside a terminal.
2. Let a user comment on a plan item immediately, in place, without copying context or writing a new chat prompt.
3. Make every meaningful visible element keyboard-addressable.
4. Attach durable feedback to semantic identities rather than screen coordinates.
5. Return comments to an agent in a machine-readable form with enough context to act on them.
6. Let an agent request review, wait, and resume automatically when the human finishes reviewing.
7. Preserve annotations across artifact revisions when targets remain semantically equivalent.
8. Clearly retain and expose annotations whose targets were deleted or cannot be safely remapped.
9. Support a fast loop: publish, inspect, annotate, submit review, revise, verify.
10. Work locally and offline with one distributable binary.
11. Render safely: artifact documents are data and cannot emit terminal escapes or execute code.

## 3. Non-goals for v1

- Pixel graphics, browser rendering, HTML/CSS compatibility, or arbitrary images.
- A general application runtime or arbitrary event handlers embedded in artifacts.
- Real-time multi-user collaboration or cloud synchronization.
- Freehand drawing and coordinate-based annotations.
- Automatic semantic re-anchoring across arbitrary rewrites.
- Replacing source-code review tools. TAS may render code and diffs, but feedback is anchored to the artifact document.
- Full bidirectional editing of the artifact by the human. Human-authored changes are comments and feedback state transitions.

## 4. Design principles

### 4.1 Semantic before visual

Feedback targets stable element IDs and logical source ranges. Terminal rows and columns are only a rendered projection and are never persisted as the authoritative anchor.

### 4.2 Immutable revisions

Every successful publish creates an artifact revision. Previous documents and feedback context remain inspectable.

### 4.3 Human-controlled completion

An agent may acknowledge feedback and mark it addressed in a particular revision. Only the human resolves it by default. This prevents an agent from silently closing feedback it did not satisfy.

### 4.4 Safe declarative documents

The schema contains known node types, constrained styling, and data. It contains no scripts, shell commands, arbitrary ANSI sequences, or dynamically loaded renderer code.

### 4.5 Keyboard-first, mouse-optional

Every operation is available from the keyboard. Mouse hit testing can be added without becoming required.

### 4.6 Graceful terminal degradation

Artifacts remain usable in small, monochrome, and 256-color terminals. Color and Unicode improve presentation but do not carry unique meaning.

## 5. Primary user flow

### 5.1 Review an agent-generated plan in place

This is the lead MVP scenario and should determine product tradeoffs.

1. The agent publishes a structured `plan` artifact and creates a review request for that exact revision.
2. The agent waits at the review checkpoint instead of ending the workflow and requiring another user prompt.
3. The TUI shows the plan with a visible **Reviewing** banner. Each plan item is a separately focusable semantic node.
4. While reading, the user focuses an item and presses `c`. A compact composer opens without replacing the plan or requiring the user to quote it.
5. TAS automatically records the plan ID, revision, item ID, item text, structural path, and nearby context. The user writes only their thought.
6. Saving the comment immediately persists it, closes the composer, marks the item with a feedback badge, and returns focus to the plan so review can continue.
7. The user may comment on as many items as needed and can edit any pending comment from its badge.
8. The user invokes **Finish review** once. TAS atomically submits the pending comments as one structured review bundle.
9. The waiting agent resumes automatically with the bundle. The user does not create a follow-up prompt, copy plan text, enumerate references, or remind the agent what it generated.
10. The agent revises the plan and publishes a new revision. TAS maps comments by stable plan-item IDs and lets the user verify each response.

The interaction succeeds only if adding a comment feels cheaper than holding the thought in memory. Opening the composer, saving, and returning to reading must all happen in the current TUI context.

### 5.2 Capture versus delivery

Comments are written to durable storage as soon as they are saved. During an active review request they have `deliveryState: pending` until **Finish review**, which prevents the agent from changing the plan while the human is still reading it. Finishing the review submits all pending comments and emits one `review.submitted` event.

Comments created outside a review request are submitted immediately. A workspace may opt into live delivery during review, but batched delivery is the recommended default because it avoids agent churn and layout movement during inspection.

### 5.3 General artifact revision flow

For artifacts outside a plan review, the user can still focus any annotatable element, add feedback, and let the agent retrieve it by event cursor. The agent acknowledges the item, publishes a revision from the latest base, and marks feedback addressed in that revision. TAS computes a structural difference, resolves anchors, and leaves final resolution to the human.

## 6. User interface

### 6.1 Default layout

```text
┌ artifact title · revision · REVIEWING · 2 comments pending ────────┐
│                                                                    │
│                         artifact canvas                            │
│                                                                    │
├───────────────────────────────────────┬────────────────────────────┤
│ selected element path and metadata    │ feedback drawer (optional) │
└ mode · keys · validation/status message ───────────────────────────┘
```

The feedback drawer and document outline are toggles. On narrow terminals they become full-screen overlays instead of reducing the canvas to an unusable width.

### 6.2 Interaction modes

- **Browse:** move through focusable elements and scroll the canvas.
- **Inspect:** show element ID, type, path, dimensions, revision change state, and attached feedback.
- **Select:** choose a text/code range or a structured table cell.
- **Comment:** use a compact composer while keeping the target visible.
- **Review:** inspect pending comments and finish or cancel the active review request.
- **Feedback:** filter, inspect, reply to, resolve, or reopen annotations.
- **Revision:** compare the current artifact with an earlier revision.
- **Help:** searchable key reference.

Mode is always visible in the footer. `Esc` returns toward Browse mode and never silently discards a non-empty comment.

### 6.3 Proposed key map

| Key | Action |
|---|---|
| `Tab` / `Shift-Tab` | Next/previous focusable element |
| Arrow keys | Spatial navigation; scroll when no neighbor exists |
| `j` / `k` | Next/previous item in lists, outlines, and feedback |
| `Enter` | Inspect focused element or activate a local view control |
| `c` | Quick-comment on the focused element/selection |
| `v` | Begin logical range selection where supported |
| `f` | Open/filter feedback |
| `S` | Finish and submit the active review |
| `o` | Toggle document outline |
| `[` / `]` | Previous/next artifact revision |
| `d` | Toggle structural change overlay |
| `?` | Help |
| `Esc` | Leave current mode |
| `q` | Quit from Browse mode |

Keys will be configurable in a workspace TOML file. Mouse support, if enabled, maps terminal cells through the same hit map used by keyboard focus.

### 6.4 Quick-comment behavior

- `c` opens the composer inline when space permits and as a bottom overlay on narrow terminals. It never navigates to a separate chat or prompt screen.
- The focused item remains visible and highlighted behind or beside the composer.
- The target reference and excerpt are displayed automatically but are not part of the editable message.
- `Ctrl-S` saves; empty comments are rejected; `Esc` offers to keep a draft instead of discarding text.
- After saving, the composer closes and focus returns to the target or optionally advances to the next plan item.
- A gutter badge shows comment count and pending/submitted state. The feedback drawer is not required for quick capture.
- Draft text autosaves during composition and survives terminal resize or process failure.

### 6.5 Focus and hit testing

Each render pass produces:

1. terminal cells,
2. a bounding box for every visible node,
3. a cell-to-semantic-source hit map for selectable content, and
4. a focus graph.

Tab order follows document order. Arrow navigation chooses the nearest candidate in the requested direction using overlap first and distance second. The outline exposes off-screen or zero-height nodes, so clipped content remains reachable.

## 7. Artifact document model

### 7.1 Envelope

An artifact is a versioned declarative tree. The exact schema will be published as JSON Schema and generated from the Rust types.

```json
{
  "schemaVersion": "tas.artifact/v1",
  "artifactId": "checkout-review",
  "baseRevision": 3,
  "title": "Checkout review",
  "metadata": {
    "source": "agent",
    "generator": "checkout-prototype"
  },
  "root": {
    "id": "screen.checkout",
    "type": "column",
    "layout": { "gap": 1, "padding": 1 },
    "children": [
      {
        "id": "heading.checkout",
        "type": "text",
        "props": { "text": "Confirm your order", "role": "heading" }
      },
      {
        "id": "summary.items",
        "type": "table",
        "props": {
          "columns": [
            { "id": "item", "label": "Item" },
            { "id": "price", "label": "Price", "align": "right" }
          ],
          "rows": [
            {
              "id": "row.keyboard",
              "cells": { "item": "Keyboard", "price": "$99.00" }
            }
          ]
        }
      },
      {
        "id": "action.submit",
        "type": "button",
        "props": { "label": "Place order", "variant": "primary" }
      }
    ]
  }
}
```

`revision` is assigned by TAS and is not trusted from an input document. A publish supplies `baseRevision` separately or in the envelope. The operation fails with a conflict if that base is no longer current.

### 7.2 Node contract

All nodes have:

- `id`: unique, stable within an artifact, and valid across revisions.
- `type`: a renderer type from the supported schema.
- `props`: type-specific content and behavior.
- `layout`: optional size, flex, alignment, gap, padding, and overflow constraints.
- `style`: optional tokenized presentation.
- `children`: ordered child nodes where allowed.
- `annotatable`: optional boolean, defaulting to true for semantic nodes.
- `metadata`: optional small JSON object returned to the agent but not interpreted by the renderer.

Node IDs are semantic identities, not array positions. Generators should prefer names such as `billing.address` or stable data keys such as `invoice.line.4f92`; they must not reuse an ID for a different concept. A revision validator warns about suspicious ID reuse based on node type and content fingerprints.

### 7.3 Initial node set

**Layout**

- `row`, `column`, `grid`, `box`, `spacer`, `divider`

**Structured documents and plans**

- `plan`, `planItem`, `section`, `paragraph`

A `planItem` has a stable ID plus `title`, optional `body`, `ordinal`, and `status` properties. Plan items may be nested. They are first-class nodes rather than undifferentiated Markdown list text so focus, comments, revisions, and agent responses all refer to the same item directly. An adapter may convert Markdown plans, but agents should publish native plan nodes whenever possible.

**Content**

- `text`, `markdown`, `code`, `list`, `table`, `tree`, `keyValue`, `badge`

**Terminal visualizations**

- `progress`, `sparkline`, `barChart`

**Representational controls**

- `button`, `input`, `select`, `checkbox`, `tabs`

Controls are useful in interface mockups but do not run agent-provided callbacks. Tabs, tree expansion, and similar view state may be manipulated locally by the TUI. Simulated state transitions and interaction-event recording are candidates for a later version.

### 7.4 Styling

Styling is constrained and renderer-owned:

- semantic foreground/background tokens with optional RGB values,
- attributes such as bold, dim, italic, and underline,
- predefined border styles,
- horizontal and vertical alignment,
- fixed, percentage, content, and flex dimensions,
- padding and gap.

Raw ANSI and arbitrary terminal escape strings are rejected. RGB colors are quantized for the active terminal. Every built-in theme has 24-bit, 256-color, and monochrome mappings.

### 7.5 Validation limits

Defaults, configurable downward by a workspace administrator:

- artifact JSON: 1 MiB,
- nodes: 10,000,
- tree depth: 64,
- single textual property: 256 KiB,
- metadata per node: 8 KiB,
- annotation message: 64 KiB.

Validation errors include a JSON path, error code, and actionable message. Unknown node types or fields fail under v1 rather than rendering unpredictably.

## 8. Annotation model

### 8.1 Annotation thread

An annotation is a durable thread, not just a string.

```json
{
  "id": "fb_01J...",
  "artifactId": "checkout-review",
  "createdRevision": 4,
  "reviewId": "review_01J...",
  "deliveryState": "submitted",
  "target": {
    "nodeId": "summary.items",
    "selector": {
      "kind": "tableCell",
      "rowId": "row.keyboard",
      "columnId": "price"
    }
  },
  "targetSnapshot": {
    "nodeType": "table",
    "documentPath": ["screen.checkout", "summary.items"],
    "excerpt": "$99.00",
    "fingerprint": "sha256:..."
  },
  "status": "open",
  "priority": "normal",
  "tags": ["copy"],
  "messages": [
    {
      "id": "msg_01J...",
      "author": { "kind": "human", "name": "local-user" },
      "body": "Make the currency explicit for international users.",
      "createdAt": "2026-01-15T19:20:31Z"
    }
  ],
  "anchorState": "active",
  "updatedEvent": 42
}
```

Messages use a safe Markdown subset for display and are always available as plain source text to agents.

### 8.2 Selector types

Every selector is scoped to a `nodeId`.

- `node`: the entire node.
- `textRange`: start/end Unicode scalar offsets plus exact text, prefix, and suffix context.
- `codeRange`: one-based start/end line and column plus exact text context.
- `tableRow`: stable row ID.
- `tableCell`: stable row and column IDs.
- `treeItem`: stable item ID.

Rendered terminal coordinates are included only as transient diagnostics and never used to restore an anchor.

### 8.3 Anchor resolution across revisions

When a revision is published, TAS resolves each non-resolved annotation in this order:

1. Find the same node ID.
2. Confirm the node type and selector subtype still apply.
3. Resolve stable sub-IDs such as row and column IDs.
4. For a textual range, verify the original exact/context quote at its prior logical offset.
5. If it moved, search for a unique exact/context match within the same node.
6. Otherwise mark the anchor `ambiguous` or `orphaned`; never guess across different nodes.

Possible anchor states are `active`, `moved`, `changed`, `ambiguous`, and `orphaned`. Old context remains available in every state. The TUI groups ambiguous and orphaned feedback visibly, and a human may manually retarget it.

### 8.4 Feedback workflow state

```text
open → acknowledged → addressed → resolved
  ↑          │            │          │
  └──────────┴────────────┴── reopen ┘
                         ↘ wont-fix
```

- Human creates `open` feedback.
- Agent may set `acknowledged` and add a reply.
- Agent may set `addressed` only with an `addressedInRevision` value.
- Human resolves, reopens, or accepts `wont-fix`.
- By default only a human can move an item to `resolved`.

Status changes and messages are append-only events. Current status is a projection of the event history.

### 8.5 Review sessions

A review session is the handoff boundary between immediate thought capture and agent action.

```json
{
  "id": "review_01J...",
  "artifactId": "implementation-plan",
  "revision": 1,
  "state": "collecting",
  "requestedBy": { "kind": "agent", "name": "coding-agent" },
  "instructions": "Review this plan before implementation begins.",
  "pendingFeedbackCount": 2,
  "createdAt": "2026-01-15T19:20:31Z"
}
```

Review states are `collecting`, `submitted`, and `cancelled`.

- An agent requests review for one immutable artifact revision.
- Saved comments are durable and visible to the human immediately, but have `deliveryState: pending` while the review is collecting.
- Normal agent feedback queries exclude pending comments unless `includePending` is explicitly requested. This prevents accidental early action.
- **Finish review** changes all associated pending comments to `submitted`, changes the session state, and appends `review.submitted` in one transaction.
- A blocked CLI wait operation or host adapter receives the complete feedback bundle and resumes the agent.
- Cancelling a review does not delete comments; the human chooses whether to retain them as drafts or submit them independently.

This session is not another prompt. The only human-authored text is the thought attached to each relevant item; TAS constructs and delivers the structured review envelope.

## 9. Revisions and updates

### 9.1 Publish semantics

The MVP accepts a complete document snapshot on every publish. Full snapshots keep the agent contract simple and permit complete validation before a transaction commits.

A publish transaction:

1. validates schema and resource limits,
2. verifies `baseRevision` against the current revision,
3. verifies all node IDs are unique,
4. assigns the next revision,
5. computes node-ID-based structural changes,
6. stores the immutable snapshot and change summary,
7. re-evaluates annotation anchors,
8. appends a monotonic workspace event, and
9. commits atomically.

On a stale base, TAS returns `REVISION_CONFLICT` with the current revision. It never silently overwrites a concurrent update.

Domain-level patch operations keyed by node ID may be added after the snapshot workflow is proven. JSON Patch is not recommended because array-index paths are fragile and conflict with stable semantic addressing.

### 9.2 Structural diff

The diff classifies nodes as added, removed, moved, content-changed, style-changed, or unchanged. The TUI can render a change gutter/overlay and inspect before/after node representations. Diffing is deterministic by stable ID; it does not attempt expensive visual screenshot comparison.

### 9.3 Event cursor

All artifact, feedback, and status changes receive a monotonically increasing workspace event ID. Agents call `feedback.list(afterCursor=...)` and persist the returned cursor. This separates “have I observed this?” from workflow status and avoids using destructive read/ack queues.

## 10. Agent interfaces

The CLI is the canonical agent interface. The interactive UI uses the controlling terminal, diagnostics use stderr, and the final structured feedback uses stdout. An agent can invoke the command and wait for its ordinary process result without a protocol server or SDK integration.

Persisting annotations alone is not sufficient for the plan-review use case: the invoking agent must remain blocked or run `feedback wait` so it resumes without requiring a new user prompt. Host-specific extensions may provide native UI, but they must preserve the CLI's output schema and storage behavior.

### 10.1 CLI

```sh
# Blocking interactive review; agent receives stdout after Finish review
tas review PLAN.md --format json
tas review PLAN.md --format prompt

# Retrieve reviews completed in another process
tas feedback latest --format json
tas feedback list --format json
tas feedback wait --format json --timeout 300000

# Future generalized artifact operations
tas artifact publish --file artifact.json --base-revision 3 --json
tas artifact get checkout-review --revision latest --json
tas artifact list --json
tas schema artifact > artifact.schema.json
tas doctor
```

Commands print human-readable output only when stdout is an interactive terminal. Captured or redirected output defaults to stable JSON. TUI output never enters stdout, diagnostics go to stderr, and nonzero exits produce no machine payload. The review CLI uses a workspace lock and documented exit codes.

### 10.2 Feedback response shape

`feedback_list` returns both original and current context:

```json
{
  "items": [
    {
      "id": "fb_01J...",
      "status": "open",
      "target": { "nodeId": "summary.items", "selector": { "kind": "tableCell", "rowId": "row.keyboard", "columnId": "price" } },
      "originalContext": { "revision": 4, "excerpt": "$99.00" },
      "currentContext": { "revision": 5, "excerpt": "USD 99.00" },
      "anchorState": "changed",
      "messages": []
    }
  ],
  "nextCursor": 47
}
```

## 11. Persistence and process model

### 11.1 Workspace layout

```text
project/
  .tas/
    config.toml
    state.db
    state.db-wal          # transient when open
    state.db-shm          # transient when open
    exports/              # explicit portable exports
```

`.tas/state.db*` should normally be ignored by Git. `tas export` will produce reviewable JSON/JSONL bundles when feedback needs to be committed or transferred. Whether exports are part of the MVP is a review decision.

### 11.2 SQLite store

SQLite in WAL mode is the source of truth. Logical tables include:

- `artifacts`
- `artifact_revisions`
- `review_sessions`
- `annotations`
- `annotation_messages`
- `annotation_events`
- `workspace_events`
- `actors`
- `schema_migrations`

Revision documents may be compressed after the MVP if measurements justify it. Foreign keys and checksums are enabled. Migrations are transactional, forward-only, and preceded by a backup for destructive changes.

### 11.3 Concurrency and live refresh

The TUI and CLI wait/read processes can be separate processes. They use short SQLite transactions and WAL concurrency. The TUI polls the lightweight `workspace_events` tail approximately every 100–250 ms and immediately refreshes affected projections. This removes the need for a resident daemon or local network socket in v1.

A future Unix-domain-socket notifier may reduce polling, but it is an optimization rather than part of correctness. The database event log remains authoritative.

### 11.4 Crash behavior

- Artifact revisions and annotation changes commit atomically.
- Draft comments autosave separately and are restored after a crash.
- The TUI never leaves the terminal in raw mode; panic hooks restore terminal state.
- `tas doctor` checks schema version, database integrity, stale drafts, terminal capabilities, and configuration.

## 12. Rendering architecture

### 12.1 Pipeline

```text
JSON document
  → schema validation
  → typed artifact tree
  → intrinsic measurement
  → constrained layout
  → clipped render boxes
  → terminal cell buffer + semantic hit map
  → terminal diff flush
```

Measurement and layout are pure functions of document, viewport, theme metrics, and local view state. The same input must produce the same cell buffer, enabling snapshot tests.

### 12.2 Layout rules

- Parent nodes allocate a content rectangle after border and padding.
- Fixed/content dimensions are measured first, percentages second, and remaining space goes to flex children.
- Width is resolved before wrapped-content height.
- Overflow defaults to clipping; content nodes may opt into vertical scrolling.
- Minimum sizes take precedence over preferred sizes; maximum sizes clamp afterward.
- If constraints cannot be satisfied, TAS renders a visible overflow indicator and records a diagnostic rather than panicking.
- Unicode width uses a pinned width implementation. Ambiguous-width behavior is configurable.

### 12.3 Local view state

Scroll positions, expanded tree nodes, active tabs, focused element, and pane arrangement are local TUI state keyed by artifact and revision. They are not artifact revisions and are not sent to the agent unless a future interaction-recording feature is explicitly enabled.

### 12.4 Plain rendering

`tas artifact render --plain` emits a linear, escape-free representation for logs, screen readers, debugging, and terminals without interactive capabilities. Semantic IDs can optionally be shown beside elements.

## 13. Security and trust boundaries

1. Strip or visibly replace C0/C1 control characters except allowed whitespace before rendering.
2. Reject raw ANSI, OSC, DCS, terminal hyperlinks, and embedded command definitions.
3. Never execute commands from artifact data or annotation Markdown.
4. Do not fetch remote URLs in v1.
5. Treat file paths and links as text; any future opener requires confirmation and an allowlist.
6. Enforce node, depth, text, metadata, and render-time limits to prevent memory/CPU abuse.
7. Keep CLI feedback on stdout and data in the local workspace by default.
8. Record actor and timestamp on all feedback mutations.
9. Redact secrets only through an explicit future policy; TAS must not claim automatic secret detection.

## 14. Recommended implementation stack

Use **Rust** for the first implementation:

- `ratatui` for TUI widgets and cell buffering,
- `crossterm` for terminal input/output,
- `serde` / `serde_json` for the protocol,
- `schemars` plus a JSON Schema validator for schema publication and validation,
- `rusqlite` with bundled SQLite for persistence,
- `tokio` only if process coordination demonstrates a real async need,
- `pulldown-cmark` or a smaller parser for the safe Markdown subset,
- `unicode-width` and Unicode segmentation crates with pinned behavior.

Why Rust: a single binary, predictable startup and memory use, strong typed schema, good terminal libraries, and no runtime installation. Keep the renderer and domain logic as libraries so a different frontend can be added without coupling it to CLI parsing.

Proposed crate/module boundaries:

```text
crates/
  tas-model/       artifact and feedback types, schema, validation
  tas-store/       SQLite repositories, migrations, event log
  tas-layout/      measurement, layout, hit maps, structural diff
  tas-render/      node renderers, themes, terminal capability mapping
  tas-app/         TUI state machine and commands
  tas-protocol/    stable CLI DTOs and error codes
  tas-cli/         tas binary, interactive reviewer, feedback readers/waiter
```

A Cargo workspace is preferable even if these begin as modules; it makes trust and dependency boundaries testable.

## 15. Observability and diagnostics

- Structured logs go to a rotating file under the user cache directory, never onto the active alternate screen.
- `RUST_LOG`-style filtering may be enabled for development.
- Each failed publish receives a correlation ID included in diagnostics.
- A developer overlay can show layout boxes, node IDs, hit-map ownership, focus order, and render timings.
- No telemetry leaves the machine unless a future opt-in design is separately approved.

## 16. Testing strategy

### 16.1 Unit/property tests

- Schema validation, ID uniqueness, size/depth limits.
- Layout invariants: no negative rectangles, bounded clipping, deterministic output.
- Focus order and spatial navigation.
- Unicode cell/source mapping across combining marks, wide glyphs, wrapping, and tabs.
- Annotation state transitions and role permissions.
- Anchor resolution under insertions, deletions, movement, and ambiguity.
- Revision conflict behavior and event cursor monotonicity.

### 16.2 Golden tests

- Cell-buffer snapshots at 40×12, 80×24, 120×40, and 200×60.
- True-color, 256-color, and monochrome theme output.
- Every built-in node type and overflow mode.
- Structural change overlays and orphaned feedback views.

### 16.3 Integration tests

- Publish through CLI while the TUI watches the same workspace.
- Start a plan review, add comments to several focused plan items, finish once, and verify the waiting agent receives one ordered feedback bundle without a new prompt.
- Verify pending review comments survive a crash but remain excluded from normal agent queries until submission.
- Add feedback in a headless TUI harness and retrieve it through CLI list/latest/wait commands.
- Publish a follow-up revision and verify anchor remapping.
- Force stale-base concurrent publishes and verify one conflicts.
- Kill processes during writes and verify database integrity and draft recovery.
- Run in a pseudo-terminal to verify raw-mode cleanup and resize behavior.

### 16.4 Fuzzing

Fuzz JSON validation, deeply nested documents, Unicode wrapping, Markdown parsing, and layout calculations. The renderer must return a diagnostic rather than panic for any validated document.

## 17. Performance targets

For an artifact with 2,000 nodes and a 120×40 viewport on a typical developer laptop:

- validated publish commit: under 200 ms,
- TUI visibility after external commit: under 300 ms,
- focus/navigation response: under 50 ms,
- viewport resize and render: under 100 ms,
- quick-comment composer open: under 50 ms,
- local comment save and return to browsing: under 100 ms,
- feedback query: under 100 ms.

These are p95 local targets, not hard protocol guarantees. Large documents should render only visible cells, but v1 may initially lay out the complete tree if profiling stays within targets.

## 18. Delivery plan

### Milestone 0: Contract prototypes

- Finalize terminology and v1 artifact/feedback JSON Schemas.
- Build 6–10 fixture artifacts, starting with nested implementation plans, then a form mockup, dashboard, table, code review, tree, and narrow-terminal cases.
- Validate quick comments, the review handoff, and anchoring by manually walking two plan revision cycles.
- Exit criterion: fixtures express the intended artifacts without raw renderer escape hatches.

### Milestone 1: End-to-end vertical slice

- Create the Rust workspace and SQLite migrations.
- Implement `plan`, `planItem`, `text`, `column`, `row`, and `box`.
- Implement `tas init`, `artifact publish/get`, `review request/wait`, `feedback list`, and `tas open`.
- Implement plan-item focus, the quick-comment composer, pending badges, and **Finish review**.
- Implement full-snapshot revisions and event polling.
- Exit criterion: an agent can publish a plan and wait; a human can comment on several items without leaving the TUI; finishing the review resumes the agent with one structured bundle and no new user prompt.

### Milestone 2: Durable revision loop

- Add optimistic concurrency, structural diff, annotation threads, statuses, and roles.
- Add selectors and re-anchoring for text/code/table content.
- Add change inspection, addressed/reopen/resolve UX, drafts, and crash recovery.
- Exit criterion: comments survive a normal revision and remain visible as orphaned when a target is removed.

### Milestone 3: Renderer breadth and accessibility

- Add remaining v1 node types, constrained styling, responsive layout, themes, and plain rendering.
- Add outline, feedback drawer, revision browser, mouse hit testing, and monochrome support.
- Exit criterion: all golden fixtures work at supported viewport/color combinations without mouse use.

### Milestone 4: Agent integration and hardening

- Harden the CLI stdout contract, feedback wait behavior, and stable machine error codes.
- Add resource limits, fuzzing, `tas doctor`, export/import if approved, and packaging.
- Document generator guidance, especially stable ID policy.
- Exit criterion: acceptance criteria below pass in CI and install artifacts are reproducible.

### Deferred candidates

- Domain-level patches keyed by node ID.
- Interaction recording and state-machine prototypes.
- Side-by-side artifact comparison where terminal width permits.
- Pluggable trusted renderers via a separately sandboxed protocol.
- Remote/multi-user synchronization.

## 19. MVP acceptance criteria

1. An agent can publish a structured plan, request review, and wait without ending the workflow.
2. A valid artifact published from another process appears in an open TUI without restart.
3. The artifact is usable at 80×24 and remains recoverable, with overlays, at 40×12.
4. Every plan item and annotatable visible element is reachable by keyboard.
5. A human can focus a plan item, press `c`, save a thought, and continue reading without entering a separate prompt or manually identifying the target.
6. Pending comments are visibly badged, durable, and editable before review submission.
7. **Finish review** submits all pending comments once and automatically returns an ordered, contextual bundle to the waiting agent.
8. The agent receives each comment with stable ID, original context, current context, review ID, status, and cursor.
9. Publishing from a stale base fails without data loss.
10. A new revision preserving plan-item/node IDs preserves attached feedback.
11. Deleting a target marks feedback orphaned and retains its original excerpt.
12. An agent can mark feedback addressed in a revision, but cannot resolve it under default policy.
13. Invalid/untrusted content cannot inject terminal escapes or execute commands.
14. A crash during a write leaves the last committed revision, pending review, and feedback readable.
15. JSON, prompt, and persisted CLI outputs expose equivalent feedback content.

## 20. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Agents generate unstable IDs | Clear ID rules, schema examples, suspicious-reuse warnings, and fixture tests |
| Terminal layouts vary by width/Unicode behavior | Pinned width logic, capability profiles, snapshots in several viewport modes |
| Precise text anchors become stale | Quote context, conservative same-node matching, explicit ambiguous/orphaned states |
| Schema grows into a terminal browser | Keep a small node set and reject arbitrary scripting/CSS |
| Large artifacts make navigation noisy | Outline/filtering, annotatable flags, viewport virtualization after profiling |
| Agent starts revising while the human is still reviewing | Keep review comments pending until an explicit **Finish review** boundary |
| A blocking agent wait is unsupported by a host | Use cancellable long-polling or a host adapter that resumes on `review.submitted` |
| SQLite concurrency surprises | WAL, short transactions, busy timeout, integration tests, immutable revisions |
| Agent incorrectly claims completion | Agent may only mark addressed; human resolves by default |
| Comments are trapped in local state | Provide explicit JSON/JSONL export/import if approved for MVP |

## 21. Decisions requested before implementation

1. **Name:** keep `Terminal Artifact System` / `tas`, or choose a product name?
2. **Technology:** approve Rust and the single-binary architecture?
3. **Review delivery:** batch comments behind **Finish review** by default, or send every saved comment to the agent immediately?
4. **Host behavior:** require the agent integration to support wait/resume in the MVP so no follow-up prompt is needed?
5. **MVP precision:** include text/code/table sub-selection in the MVP, or ship plan-item/node-level annotations first and add precise selectors immediately afterward?
6. **Feedback ownership:** approve the default rule that agents can mark addressed but only humans can resolve?
7. **Version storage:** retain every local revision indefinitely by default, or introduce configurable pruning at launch?
8. **Portability:** include export/import in the MVP so feedback can be committed or shared, or keep it local-only initially?
9. **Controls:** keep controls representational in v1, or require simulated interaction state and event recording?

Recommended defaults are: keep the working name until a vertical slice exists; use Rust for a later production rewrite; batch comments until **Finish review**; require CLI wait/resume because it removes the new-prompt pain point; start with plan-item/node-level comments while designing precise selectors now; keep the CLI as the sole integration contract; retain human-only resolution; retain all revisions for v1; include a simple export before release; and defer simulated interactions.
