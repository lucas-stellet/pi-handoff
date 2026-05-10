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

export const buildContinuationPrompt = ({ handoffPath }: { handoffPath: string }): string => {
  return `This session continues from a previous Pi session. Read \`${handoffPath}\`, continue from where the last agent stopped, and ask the user if anything is unclear.`;
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
  const handoff = (await generateHandoff(generationPrompt)).trim();
  if (!handoff) {
    throw new Error("Generated handoff was empty");
  }

  const handoffPath = buildHandoffPath(cwd, sessionName?.trim() || sessionId);
  await writeTextFile(handoffPath, handoff);

  return {
    handoff,
    handoffPath,
    continuationPrompt: buildContinuationPrompt({ handoffPath }),
  };
};
