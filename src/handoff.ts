import { join } from "node:path";

export type TextContent = {
  type?: string;
  text?: string;
};

export type SessionLikeEntry = {
  type?: string;
  content?: unknown;
  message?: {
    role?: string;
    content?: unknown;
  };
};

export type GitContext = {
  branch?: string;
  status?: string;
  diffStat?: string;
  recentCommits?: string;
};

export type CreateHandoffArtifactsInput = {
  cwd: string;
  sessionName?: string;
  sessionId: string;
  focus?: string;
  entries: SessionLikeEntry[];
  collectGitContext: () => Promise<GitContext>;
  generateHandoff: (prompt: { systemPrompt: string; userPrompt: string }) => Promise<string>;
  writeTextFile: (path: string, content: string) => Promise<void>;
};

export type HandoffArtifacts = {
  handoff: string;
  handoffPath: string;
  continuationPrompt: string;
};

export const slugifySessionIdentifier = (value: string): string => {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "handoff";
};

export const buildHandoffPath = (cwd: string, sessionNameOrId: string): string => {
  return join(cwd, ".handoff", `${slugifySessionIdentifier(sessionNameOrId)}.md`);
};

const extractTextParts = (content: unknown): string[] => {
  if (typeof content === "string") return [content.trim()].filter(Boolean);
  if (!Array.isArray(content)) return [];

  return content
    .filter((part): part is TextContent => Boolean(part) && typeof part === "object")
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text!.trim())
    .filter(Boolean);
};

export const extractConversationText = (entries: SessionLikeEntry[]): string => {
  const sections: string[] = [];

  for (const entry of entries) {
    if (entry.type !== "message" || !entry.message?.role) continue;

    const { message } = entry;
    const text = extractTextParts(message.content).join("\n").trim();
    if (!text) continue;

    if (message.role === "user") {
      sections.push(`User: ${text}`);
      continue;
    }

    if (message.role === "assistant") {
      sections.push(`Assistant: ${text}`);
    }
  }

  return sections.join("\n\n");
};

export const buildContinuationPrompt = ({ handoffPath, focus }: { handoffPath: string; focus?: string }): string => {
  const basePrompt = `This session continues from a previous Pi session. Read \`${handoffPath}\`, continue from where the last agent stopped, and ask the user if anything is unclear.`;
  const trimmedFocus = focus?.trim();

  return trimmedFocus ? `${basePrompt}\n\n${trimmedFocus}` : basePrompt;
};

const available = (value: string | undefined): string => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "Not available";
};

export const formatGitContext = (context: GitContext): string => {
  return [
    `Branch: ${available(context.branch)}`,
    "Status:",
    available(context.status),
    "",
    "Diff stat:",
    available(context.diffStat),
    "",
    "Recent commits:",
    available(context.recentCommits),
  ].join("\n");
};

export const HANDOFF_SYSTEM_PROMPT = [
  "You are a context transfer assistant for Pi coding sessions.",
  "Generate a concise, simple handoff document for a fresh agent.",
  "Do not add preamble. Output Markdown only.",
].join("\n");

export const buildGenerationPrompt = ({
  conversationText,
  gitContext,
  focus,
}: {
  conversationText: string;
  gitContext: string;
  focus?: string;
}): { systemPrompt: string; userPrompt: string } => {
  const trimmedFocus = focus?.trim();

  const promptLines = [
    "Write a concise handoff document so a fresh agent can continue the work.",
    "",
    "Keep the handoff simple and action-oriented.",
    "",
    "Do not include:",
    "- a transcript of the conversation",
    "- which tools were called",
    "- tool call results",
    "- raw command outputs",
    "- generic conversation summaries",
    "- duplicated content already captured elsewhere",
    "",
    "Do include:",
    "- the current objective",
    "- what has already been decided",
    "- what remains to do",
    "- important files, artifacts, PRDs, plans, ADRs, issues, commits, or diffs by path or URL",
    "- any constraints, preferences, or risks the next agent must know",
    "- suggested skills for the next session, if any",
    "",
    "Do not duplicate content already captured in other artifacts (PRDs, plans, ADRs, issues, commits, diffs). Reference them by path or URL instead.",
  ];

  if (trimmedFocus) {
    promptLines.push("", "## Next-session focus", trimmedFocus);
  }

  promptLines.push(
    "",
    "## Session Conversation",
    conversationText.trim() || "Not available",
    "",
    "## Repository Context",
    gitContext.trim() || "Not available",
  );

  return {
    systemPrompt: HANDOFF_SYSTEM_PROMPT,
    userPrompt: promptLines.join("\n"),
  };
};

export const buildFallbackGenerationPrompt = ({
  originalPrompt,
  failureReason,
}: {
  originalPrompt: { systemPrompt: string; userPrompt: string };
  failureReason: string;
}): { systemPrompt: string; userPrompt: string } => ({
  systemPrompt: [
    originalPrompt.systemPrompt,
    "The previous handoff generation attempt failed.",
    "Use a different, more direct strategy and always output non-empty Markdown text.",
  ].join("\n"),
  userPrompt: [
    "The previous attempt to generate a handoff failed.",
    "Failure reason:",
    failureReason.trim() || "Unknown failure",
    "",
    "Retry with a simpler strategy:",
    "- Output at least one Markdown heading and three bullets.",
    "- If most work is already captured elsewhere, reference those artifacts instead of returning an empty answer.",
    "- Do not explain the retry or mention this failure in the handoff.",
    "",
    "Original handoff request:",
    originalPrompt.userPrompt,
  ].join("\n"),
});

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export const buildExtractiveHandoff = ({
  sessionId,
  gitContext,
  focus,
  failureReason,
}: {
  sessionId: string;
  gitContext: string;
  focus?: string;
  failureReason?: string;
}): string => {
  const trimmedFocus = focus?.trim();

  return [
    "# Handoff",
    "",
    "This handoff was generated with a deterministic fallback because the model did not return usable handoff text.",
    "",
    "## Current objective",
    trimmedFocus ? `- ${trimmedFocus}` : "- Continue the work captured in the source Pi session.",
    "",
    "## Source session",
    `- Session id: \`${sessionId}\``,
    "- Re-open or inspect that session for the full conversation context.",
    "",
    "## Repository context",
    "```text",
    gitContext.trim() || "Not available",
    "```",
    "",
    "## Next steps",
    "- Inspect the source session and repository status before making changes.",
    "- Verify whether any mentioned tests, issues, PRs, or local changes still need follow-up.",
    "- Ask the user for clarification if the next action is ambiguous.",
    ...(failureReason ? ["", "## Fallback note", `- Model handoff generation failed with: ${failureReason}`] : []),
  ].join("\n");
};

const generateHandoffWithFallback = async ({
  generationPrompt,
  sessionId,
  gitContext,
  focus,
  generateHandoff,
}: {
  generationPrompt: { systemPrompt: string; userPrompt: string };
  sessionId: string;
  gitContext: string;
  focus?: string;
  generateHandoff: CreateHandoffArtifactsInput["generateHandoff"];
}): Promise<string> => {
  let firstFailureReason = "Generated handoff was empty";
  let fallbackFailureReason = "Generated handoff was empty after fallback retry";

  try {
    const handoff = (await generateHandoff(generationPrompt)).trim();
    if (handoff) return handoff;
  } catch (error) {
    firstFailureReason = errorMessage(error);
  }

  const fallbackPrompt = buildFallbackGenerationPrompt({
    originalPrompt: generationPrompt,
    failureReason: firstFailureReason,
  });
  try {
    const fallbackHandoff = (await generateHandoff(fallbackPrompt)).trim();
    if (fallbackHandoff) return fallbackHandoff;
  } catch (error) {
    fallbackFailureReason = errorMessage(error);
  }

  return buildExtractiveHandoff({
    sessionId,
    gitContext,
    focus,
    failureReason: `${fallbackFailureReason} (first failure: ${firstFailureReason})`,
  });
};

export const createHandoffArtifacts = async ({
  cwd,
  sessionName,
  sessionId,
  focus,
  entries,
  collectGitContext,
  generateHandoff,
  writeTextFile,
}: CreateHandoffArtifactsInput): Promise<HandoffArtifacts> => {
  const conversationText = extractConversationText(entries);
  if (!conversationText.trim()) {
    throw new Error("No conversation text found to hand off");
  }

  const gitContext = formatGitContext(await collectGitContext());
  const generationPrompt = buildGenerationPrompt({ conversationText, gitContext, focus });
  const handoff = await generateHandoffWithFallback({
    generationPrompt,
    sessionId,
    gitContext,
    focus,
    generateHandoff,
  });

  const handoffPath = buildHandoffPath(cwd, sessionName?.trim() || sessionId);
  await writeTextFile(handoffPath, handoff);

  return {
    handoff,
    handoffPath,
    continuationPrompt: buildContinuationPrompt({ handoffPath, focus }),
  };
};
