# Terminal Markdown Review Demo

The goal is to remove the friction of writing a second prompt after reviewing an agent-generated plan.

## Proposed implementation

Include a lightweight test comment in the demo flow to verify reviewed feedback is captured and applied.

1. Parse the Markdown file into a syntax tree with source positions.
2. Render headings, paragraphs, lists, quotes, code blocks, and tables in the terminal.
3. Let the reviewer focus a block and attach a comment without copying its text.
4. Keep all comments pending until the reviewer chooses **Finish review**.
5. Return one structured JSON bundle to the waiting agent.

## Draft storage

For the demo, pending comments are written to atomic JSON files under `.tas/reviews/`. SQLite can wait until the interaction has been validated.

> The review experience should feel faster than opening a new prompt and explaining which sentence needs attention.

## Example command

```sh
npm run demo
```

## Questions to review

- Is block-level selection sufficient for the first version?
- Should pressing Enter or Ctrl-S save a quick comment?
- Should a review with zero comments still produce a feedback bundle?

| Capability | Demo |
| --- | --- |
| Render Markdown | Yes |
| Item comments | Yes |
| Batched handoff | Yes |
| Cross-revision anchoring | Later |
