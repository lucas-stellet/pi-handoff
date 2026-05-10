import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  buildContinuationPrompt,
  buildGenerationPrompt,
  buildHandoffPath,
  createHandoffArtifacts,
  extractConversationText,
  formatGitContext,
  slugifySessionIdentifier,
} from "./handoff.ts";

describe("package metadata", () => {
  it("points Pi at the root extension entry point", () => {
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

    assert.deepEqual(manifest.pi.extensions, ["./index.ts"]);
  });
});

describe("slugifySessionIdentifier", () => {
  it("turns session names into safe file slugs", () => {
    assert.equal(slugifySessionIdentifier(" Fix /handoff: sessão nova! "), "fix-handoff-sess-o-nova");
  });

  it("falls back when the identifier has no usable filename characters", () => {
    assert.equal(slugifySessionIdentifier("---"), "handoff");
  });
});

describe("buildHandoffPath", () => {
  it("builds a handoff path under the project .handoff directory", () => {
    assert.equal(
      buildHandoffPath("/repo", "Refactor handoff command"),
      "/repo/.handoff/refactor-handoff-command.md",
    );
  });
});

describe("extractConversationText", () => {
  it("keeps user and assistant text while omitting tool calls, tool results, and summaries", () => {
    const entries = [
      { type: "compaction", summary: "Earlier compacted summary." },
      { type: "branch_summary", summary: "Abandoned branch summary." },
      {
        type: "message",
        message: {
          role: "user",
          content: [{ type: "text", text: "Build a handoff command" }],
        },
      },
      {
        type: "message",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "I will keep this simple." },
            { type: "toolCall", name: "read", arguments: { path: "docs/extensions.md" } },
          ],
        },
      },
      {
        type: "message",
        message: {
          role: "toolResult",
          toolName: "read",
          content: [{ type: "text", text: "Extensions can register commands." }],
          isError: false,
        },
      },
    ];

    const text = extractConversationText(entries);

    assert.match(text, /User: Build a handoff command/);
    assert.match(text, /Assistant: I will keep this simple\./);
    assert.doesNotMatch(text, /Tool read called/);
    assert.doesNotMatch(text, /Tool result/);
    assert.doesNotMatch(text, /Earlier compacted summary/);
    assert.doesNotMatch(text, /Abandoned branch summary/);
  });
});

describe("buildContinuationPrompt", () => {
  it("references only the saved handoff path", () => {
    const prompt = buildContinuationPrompt({
      handoffPath: "/repo/.handoff/refactor-handoff-command.md",
    });

    assert.equal(
      prompt,
      "This session continues from a previous Pi session. Read `/repo/.handoff/refactor-handoff-command.md`, continue from where the last agent stopped, and ask the user if anything is unclear.",
    );
    assert.doesNotMatch(prompt, /<handoff>/);
    assert.doesNotMatch(prompt, /Current Objective/);
  });
});

describe("formatGitContext", () => {
  it("formats unavailable git values explicitly", () => {
    const context = formatGitContext({
      branch: undefined,
      status: undefined,
      diffStat: "",
      recentCommits: undefined,
    });

    assert.match(context, /Branch: Not available/);
    assert.match(context, /Status:\nNot available/);
    assert.match(context, /Diff stat:\nNot available/);
    assert.match(context, /Recent commits:\nNot available/);
  });
});

describe("buildGenerationPrompt", () => {
  it("asks for a simple handoff and includes the optional next-session focus", () => {
    const prompt = buildGenerationPrompt({
      conversationText: "User: Build /handoff",
      gitContext: "Branch: main\nStatus:\n M file.ts",
      focus: "focus on tests",
    });

    assert.match(prompt.systemPrompt, /context transfer assistant/);
    assert.match(prompt.userPrompt, /Keep the handoff simple and action-oriented/);
    assert.match(prompt.userPrompt, /Do not include:/);
    assert.match(prompt.userPrompt, /which tools were called/);
    assert.match(prompt.userPrompt, /suggested skills/);
    assert.match(prompt.userPrompt, /## Next-session focus\nfocus on tests/);
    assert.match(prompt.userPrompt, /User: Build \/handoff/);
    assert.match(prompt.userPrompt, /Branch: main/);
  });
});

describe("createHandoffArtifacts", () => {
  it("uses the session name for the handoff filename and returns a path-only continuation prompt", async () => {
    const writes: Array<{ path: string; content: string }> = [];
    const artifacts = await createHandoffArtifacts({
      cwd: "/repo",
      sessionName: "Refactor handoff command",
      sessionId: "session-123",
      focus: "focus on tests",
      entries: [
        {
          type: "message",
          message: {
            role: "user",
            content: [{ type: "text", text: "Build /handoff" }],
          },
        },
      ],
      collectGitContext: async () => ({
        branch: "main",
        status: " M index.ts",
        diffStat: "1 file changed",
        recentCommits: "abc123 feat: previous",
      }),
      generateHandoff: async ({ userPrompt }: { systemPrompt: string; userPrompt: string }) => `# Handoff\n\n${userPrompt}`,
      writeTextFile: async (path: string, content: string) => {
        writes.push({ path, content });
      },
    });

    assert.equal(artifacts.handoffPath, "/repo/.handoff/refactor-handoff-command.md");
    assert.match(artifacts.handoff, /# Handoff/);
    assert.doesNotMatch(artifacts.continuationPrompt, /# Handoff/);
    assert.match(artifacts.continuationPrompt, /\/repo\/.handoff\/refactor-handoff-command\.md/);
    assert.deepEqual(writes, [{ path: artifacts.handoffPath, content: artifacts.handoff }]);
  });
});
