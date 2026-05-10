import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  createHandoffArtifacts,
  extractConversationText,
  type GitContext,
  type SessionLikeEntry,
} from "./handoff.ts";

export type CompletionFunction = (
  model: unknown,
  request: { systemPrompt: string; messages: unknown[] },
  auth: { apiKey: string; headers?: Record<string, string> },
) => Promise<{ content: Array<{ type: string; text?: string }> }>;

const writeTextFileToDisk = async (path: string, content: string): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
};

const textFromCompletion = (content: Array<{ type: string; text?: string }>): string => {
  return content
    .filter((part): part is { type: "text"; text: string } => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim();
};

const collectGitContext = async (pi: any): Promise<GitContext> => {
  const run = async (args: string[]): Promise<string | undefined> => {
    try {
      const result = await pi.exec("git", args, { timeout: 5_000 });
      if (result.code !== 0) return undefined;
      return result.stdout.trim() || undefined;
    } catch {
      return undefined;
    }
  };

  return {
    branch: await run(["branch", "--show-current"]),
    status: await run(["status", "--short"]),
    diffStat: await run(["diff", "--stat"]),
    recentCommits: await run(["log", "--oneline", "-5"]),
  };
};

export const createHandoffCommand = (pi: any, completion: CompletionFunction) => ({
  description: "Save a concise handoff and prepare a fresh continuation session",
  getArgumentCompletions: () => [],
  handler: async (args: string, ctx: any) => {
    await ctx.waitForIdle();

    if (!ctx.hasUI) {
      ctx.ui.notify("/handoff requires an interactive or RPC UI", "error");
      return;
    }

    if (!ctx.model) {
      ctx.ui.notify("No model selected", "error");
      return;
    }

    const branch = ctx.sessionManager.getBranch() as SessionLikeEntry[];
    if (!extractConversationText(branch).trim()) {
      ctx.ui.notify("No conversation found to hand off", "warning");
      return;
    }

    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
    if (!auth.ok) {
      ctx.ui.notify(auth.error, "error");
      return;
    }
    if (!auth.apiKey) {
      ctx.ui.notify(`No API key for ${ctx.model.provider}`, "error");
      return;
    }

    const currentSessionFile = ctx.sessionManager.getSessionFile();
    const sessionName = pi.getSessionName() ?? ctx.sessionManager.getSessionName();
    const sessionId = ctx.sessionManager.getSessionId();
    const focus = args.trim();

    ctx.ui.notify("Generating handoff...", "info");

    const model = ctx.model;
    const artifacts = await createHandoffArtifacts({
      cwd: ctx.cwd,
      sessionName,
      sessionId,
      focus,
      entries: branch,
      collectGitContext: () => collectGitContext(pi),
      writeTextFile: writeTextFileToDisk,
      generateHandoff: async ({ systemPrompt, userPrompt }) => {
        const userMessage = {
          role: "user",
          content: [{ type: "text", text: userPrompt }],
          timestamp: Date.now(),
        };
        const response = await completion(
          model,
          { systemPrompt, messages: [userMessage] },
          { apiKey: auth.apiKey, headers: auth.headers },
        );
        return textFromCompletion(response.content);
      },
    }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`Failed to create handoff: ${message}`, "error");
      return undefined;
    });

    if (!artifacts) return;

    const result = await ctx.newSession({
      parentSession: currentSessionFile,
      withSession: async (replacementCtx: any) => {
        replacementCtx.ui.notify(`Handoff saved: ${artifacts.handoffPath}`, "info");
        await replacementCtx.sendUserMessage(artifacts.continuationPrompt);
      },
    });

    if (result.cancelled) {
      ctx.ui.notify("New session cancelled", "info");
    }
  },
});
