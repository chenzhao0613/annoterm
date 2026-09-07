import {spawnSync} from "node:child_process";
import path from "node:path";
import type {ExtensionAPI, ExtensionContext} from "@earendil-works/pi-coding-agent";
import type {AutocompleteItem} from "@earendil-works/pi-tui";
import {Type} from "typebox";

type ReviewResult = string | null;
type CliExecution = {
	status: number | null;
	stdout: string;
	signal: NodeJS.Signals | null;
	error?: string;
};

async function runReview(ctx: ExtensionContext, requestedPath: string): Promise<ReviewResult> {
	if (ctx.mode !== "tui") {
		ctx.ui.notify("Markdown review requires Pi interactive mode", "error");
		return null;
	}

	const reviewPath = requestedPath.trim().replace(/^@/, "");
	const execution = await ctx.ui.custom<CliExecution>((tui, _theme, _keybindings, done) => {
		let result: CliExecution;
		tui.stop();
		process.stdout.write("\x1b[2J\x1b[H");

		try {
			const child = spawnSync("tas", ["review", reviewPath, "--format", "prompt"], {
				cwd: ctx.cwd,
				env: process.env,
				encoding: "utf8",
				stdio: ["inherit", "pipe", "inherit"],
				maxBuffer: 16 * 1024 * 1024,
			});
			result = {
				status: child.status,
				stdout: child.stdout ?? "",
				signal: child.signal,
				error: child.error?.message,
			};
		} catch (error) {
			result = {
				status: null,
				stdout: "",
				signal: null,
				error: error instanceof Error ? error.message : String(error),
			};
		} finally {
			tui.start();
			tui.requestRender(true);
		}

		done(result);
		return {render: () => [], invalidate: () => {}};
	});

	if (execution.error) {
		ctx.ui.notify(`Could not run tas: ${execution.error}`, "error");
		return null;
	}
	if (execution.status === 2 || execution.status === 130 || execution.signal) return null;
	if (execution.status !== 0) {
		ctx.ui.notify(`tas review exited with code ${execution.status ?? "unknown"}`, "error");
		return null;
	}

	return execution.stdout;
}

export default function markdownReview(pi: ExtensionAPI) {
	let markdownFiles: string[] = [];

	async function refreshMarkdownFiles(cwd: string): Promise<void> {
		const result = await pi.exec(
			"rg",
			[
				"--files",
				"-g", "*.md",
				"-g", "!node_modules/**",
				"-g", "!.git/**",
				"-g", "!.tas/**",
				"-g", "!dist/**",
			],
			{cwd, timeout: 5_000},
		);
		markdownFiles = result.code === 0
			? result.stdout.split("\n").map(file => file.trim()).filter(Boolean).slice(0, 5_000)
			: [];
	}

	pi.on("session_start", async (_event, ctx) => refreshMarkdownFiles(ctx.cwd));
	pi.on("tool_result", async (event, ctx) => {
		if (event.toolName === "write" || event.toolName === "edit") {
			await refreshMarkdownFiles(ctx.cwd);
		}
	});

	function completeMarkdownPath(prefix: string): AutocompleteItem[] | null {
		const query = prefix.trim().replace(/^@/, "").toLowerCase();
		const ranked = markdownFiles
			.map(file => {
				const normalized = file.toLowerCase();
				const base = path.basename(normalized);
				const score = normalized === query ? 0 : base.startsWith(query) ? 1 : normalized.startsWith(query) ? 2 : base.includes(query) ? 3 : normalized.includes(query) ? 4 : 99;
				return {file, score};
			})
			.filter(candidate => candidate.score < 99)
			.sort((left, right) => left.score - right.score || left.file.localeCompare(right.file))
			.slice(0, 20);
		if (ranked.length === 0) return null;
		return ranked.map(({file}) => ({
			value: file,
			label: file,
			description: "Markdown file",
		}));
	}

	pi.registerTool({
		name: "review_markdown",
		label: "Review Markdown",
		description: "Open a Markdown file with the TAS CLI. The human comments on specific blocks and submits one batch. The completed feedback is returned directly as this tool result.",
		promptSnippet: "Ask the human to review a generated Markdown plan with TAS and receive anchored feedback directly",
		promptGuidelines: [
			"Use review_markdown after writing a plan that requires human review; wait for its feedback before implementing.",
		],
		parameters: Type.Object({
			path: Type.String({description: "Workspace-relative path to the Markdown file to review"}),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const result = await runReview(ctx, params.path);
			if (!result) {
				return {content: [{type: "text" as const, text: "Markdown review was cancelled or failed."}], details: {cancelled: true}};
			}
			return {content: [{type: "text" as const, text: result}]};
		},
	});

	pi.registerCommand("review-md", {
		description: "Review a Markdown file with TAS and send the completed feedback directly to the agent",
		getArgumentCompletions: completeMarkdownPath,
		handler: async (args, ctx) => {
			const requestedPath = args.trim();
			if (!requestedPath) {
				ctx.ui.notify("Usage: /review-md <path-to-markdown>", "warning");
				return;
			}
			const result = await runReview(ctx, requestedPath);
			if (!result) return;
			if (ctx.isIdle()) pi.sendUserMessage(result);
			else pi.sendUserMessage(result, {deliverAs: "followUp"});
		},
	});
}
