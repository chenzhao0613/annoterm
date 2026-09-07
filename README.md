# Annoterm

**Annoterm** (`annoterm`) is a terminal-native Markdown review CLI.
It renders an existing Markdown file as an interactive TUI, lets a reviewer attach comments to semantic blocks, and emits one agent-readable feedback bundle when the reviewer finishes the review.

- [Markdown review MVP specification](docs/markdown-review-mvp.md)
- [Broader future architecture](docs/technical-spec.md)

## Why a CLI

The CLI is the integration contract.
Annoterm does not require an MCP server, resident daemon, or agent-specific protocol.

```text
agent invokes annoterm review PLAN.md and waits
                    ↓
Annoterm renders the review UI on the controlling terminal
                    ↓
human comments on specific Markdown blocks
                    ↓
human finishes and submits the complete review
                    ↓
Annoterm writes feedback to stdout
                    ↓
the invoking agent receives the feedback and continues
```

Annoterm keeps its output streams separate:

- The interactive UI uses the controlling terminal, such as `/dev/tty` or the Windows console.
- Diagnostics use stderr.
- Submitted feedback uses stdout.

This separation lets an agent capture feedback without capturing terminal drawing commands.

## Requirements

- Node.js 20 or newer
- A terminal for interactive review
- An AI agent capable of running shell commands, or a small host adapter

## Install

From an Annoterm checkout:

```sh
npm install
npm run build
npm link
```

Verify that the global executable is available:

```sh
command -v annoterm
annoterm feedback list
```

To run Annoterm without `npm link`:

```sh
node /path/to/annoterm/dist/cli.js review PLAN.md --format prompt
```

## Review a Markdown file

```sh
annoterm review path/to/PLAN.md
```

Use JSON for structured integration:

```sh
annoterm review path/to/PLAN.md --format json
```

Use prompt-formatted Markdown when the output will be inserted directly into an agent conversation:

```sh
annoterm review path/to/PLAN.md --format prompt
```

When stdout is captured and no format is specified, Annoterm selects JSON automatically.

### Review controls

- `j` / `k` or arrows: navigate Markdown blocks
- `c`: comment on the focused block
- `Enter` or `Ctrl-S`: save the current comment as pending
- `e`: inspect or delete pending comments
- Uppercase `S`: open the finish-review confirmation
- `Enter`: submit the complete comment batch
- `q`: save the pending review and exit without submitting
- `?`: show help

Saving an individual comment does not notify the agent.
Only finishing the review submits the complete batch.

## Integration modes

### Direct mode

Direct mode is preferred when the agent can start an interactive child process with access to the controlling terminal.
The agent runs this command and waits for it to finish:

```sh
annoterm review path/to/PLAN.md --format prompt
```

After the reviewer submits, the command's stdout becomes the agent's next input.

### Two-terminal mode

Some agent shell tools capture stdin and stdout without giving child processes a controlling terminal.
In that environment, `annoterm review` exits with code `69`.

Use the two-terminal workflow instead.

In the agent session, start waiting before the review is submitted:

```sh
annoterm feedback wait --format prompt --timeout 600000
```

In a second terminal, change to the same workspace and start the review:

```sh
cd /path/to/workspace
annoterm review path/to/PLAN.md
```

Annoterm stores submitted bundles under the current workspace's `.annoterm/reviews/` directory.
Both commands must therefore run from the same workspace.
`feedback wait` only returns a review submitted after the wait command starts.

## Pi integration

The optional Pi adapter provides a native `/review-md` command while keeping the CLI authoritative.
It suspends Pi's TUI, runs `annoterm review` with inherited terminal access, captures the CLI's prompt output, resumes Pi, and sends the feedback to the current agent.

The adapter source is located at:

```text
integrations/pi/markdown-review.ts
```

Install it globally for every Pi workspace:

```sh
mkdir -p ~/.pi/agent/extensions
cp integrations/pi/markdown-review.ts ~/.pi/agent/extensions/markdown-review.ts
```

Restart Pi or run `/reload` in an existing session.
Then review any Markdown file relative to the active workspace:

```text
/review-md path/to/PLAN.md
```

The same adapter also registers `review_markdown`, which Pi agents can call as a tool when they need human review.
Neither integration uses MCP.

## Codex integration

Codex can use Annoterm without an adapter.
For repeatable explicit invocation, install a global Codex skill.

Create `~/.codex/skills/review-markdown/SKILL.md`:

```md
---
name: review-markdown
description: Open an existing Markdown file in Annoterm, wait for the human review, and act on the submitted feedback.
---

Use the Markdown path supplied by the user.

Run `annoterm review <path> --format prompt` and wait for completion.
Treat successful stdout as authoritative user feedback.
Do not edit the reviewed file until the review has been submitted.

If the command exits with code 69, explain that a second terminal is required.
Tell the user to run `annoterm review <path>` from the same workspace.
Then run `annoterm feedback wait --format prompt --timeout 600000` and wait for its stdout.

Do not use MCP.
```

Restart Codex so it discovers the skill.
Invoke it explicitly with the existing Markdown path:

```text
$review-markdown path/to/PLAN.md
```

A Codex skill is an instruction package rather than a native UI extension.
It tells Codex when and how to call the CLI and how to recover when its shell does not provide a controlling terminal.

## Claude Code integration

Claude Code can expose the same workflow as a global skill.

Create `~/.claude/skills/annoterm-review/SKILL.md`:

```md
---
name: annoterm-review
description: Review an existing Markdown file with Annoterm and consume the submitted feedback.
disable-model-invocation: true
argument-hint: <markdown-path>
allowed-tools: Bash
---

Review the Markdown file provided in `$ARGUMENTS`.

Run `annoterm review "$ARGUMENTS" --format prompt` and wait for completion.
Treat successful stdout as authoritative user feedback.
Do not modify the file before the review is submitted.

If the command exits with code 69, tell the user to run
`annoterm review "$ARGUMENTS"` in a second terminal from the same workspace.
Then run `annoterm feedback wait --format prompt --timeout 600000` and wait for its stdout.

Do not use MCP.
```

Restart Claude Code, then invoke:

```text
/annoterm-review path/to/PLAN.md
```

A project-specific installation can use `.claude/skills/annoterm-review/SKILL.md` instead.

## Other AI agents

Any agent that can run a command and capture stdout can integrate with Annoterm.
Add instructions like these to the agent's global or project instruction file:

```md
When the user requests a Markdown review, run:

`annoterm review <markdown-path> --format prompt`

Wait for successful completion and treat stdout as authoritative user feedback.
Do not modify the reviewed file before submission.
If Annoterm exits with code 69, use `annoterm feedback wait --format prompt --timeout 600000` while the user runs `annoterm review <markdown-path>` in another terminal from the same workspace.
```

For a native host adapter, preserve these rules:

1. Suspend or release the host TUI before launching Annoterm.
2. Spawn `annoterm review <path> --format prompt` without a shell.
3. Inherit stdin so Annoterm can receive keyboard input.
4. Capture stdout for the submitted feedback.
5. Inherit stderr so diagnostics remain visible.
6. Resume the host TUI after the process exits.
7. Send stdout to the agent only when Annoterm exits with code `0`.
8. Treat cancellation and nonzero exits as having no submitted feedback.

A minimal Node.js launch has this process shape:

```ts
const result = spawnSync(
  "annoterm",
  ["review", markdownPath, "--format", "prompt"],
  {
    cwd: workspace,
    encoding: "utf8",
    stdio: ["inherit", "pipe", "inherit"],
  },
);

if (result.status === 0) {
  sendFeedbackToAgent(result.stdout);
}
```

An adapter may map that final string into a tool result, follow-up message, or host-specific command result.
It should not recreate Markdown parsing, review state, or feedback formatting outside the CLI.

## Retrieve submitted feedback

Every submitted bundle is stored under `.annoterm/reviews/`.

```sh
# Newest submitted review
annoterm feedback latest --format json

# All submitted reviews, newest first
annoterm feedback list --format json

# Wait for a review submitted after this command starts
annoterm feedback wait --format json --timeout 300000
```

Available output formats are `human`, `json`, and `prompt`.

## Exit codes

| Code | Meaning |
|---:|---|
| `0` | Submitted or retrieved feedback successfully |
| `1` | Unexpected runtime error |
| `2` | Review saved or cancelled without submission |
| `4` | No submitted feedback was found |
| `64` | Invalid CLI usage |
| `66` | Markdown file unavailable or not reviewable |
| `69` | No controlling terminal available |
| `75` | Another review already holds the workspace lock |
| `124` | `feedback wait` timed out |
| `130` | Review interrupted |

Nonzero exits do not emit a feedback payload to stdout.

## Development

```sh
npm run typecheck
npm test
npm run build
```
