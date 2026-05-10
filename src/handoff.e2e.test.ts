import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createHandoffCommand } from "./command.ts";

const PI_SDK_PATH =
  process.env.PI_CODING_AGENT_SDK_PATH ?? "/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/sdk.js";
const PI_SESSION_MANAGER_PATH =
  process.env.PI_CODING_AGENT_SESSION_MANAGER_PATH ??
  "/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js";

const fakeModel = {
  id: "handoff-e2e-model",
  name: "Handoff E2E Model",
  api: "openai-completions",
  provider: "handoff-e2e",
  baseUrl: "http://127.0.0.1:9/v1",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128_000,
  maxTokens: 4_096,
};

const fakeCompletion = async () => ({
  content: [{ type: "text", text: "# E2E handoff\n\nContinue from the seeded context." }],
});

test("e2e: /handoff accepts an argument and starts the replacement Pi session with it", {
  skip: process.env.PI_HANDOFF_E2E !== "1" ? "Set PI_HANDOFF_E2E=1 to run the Pi SDK e2e test" : false,
}, async () => {
  const {
    createAgentSessionFromServices,
    createAgentSessionRuntime,
    createAgentSessionServices,
  } = await import(PI_SDK_PATH);
  const { SessionManager } = await import(PI_SESSION_MANAGER_PATH);

  const cwd = await mkdtemp(join(tmpdir(), "pi-handoff-e2e-cwd-"));
  const agentDir = await mkdtemp(join(tmpdir(), "pi-handoff-e2e-agent-"));

  try {
    const extensionFactory = (pi: any) => {
      pi.registerCommand("handoff", createHandoffCommand(pi, fakeCompletion));
    };

    const modelRegistry: any = {
      getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "test-key", headers: {} }),
    };

    const createRuntime = async ({ cwd, agentDir, sessionManager, sessionStartEvent }: any) => {
      const services = await createAgentSessionServices({
        cwd,
        agentDir,
        modelRegistry,
        resourceLoaderOptions: {
          extensionFactories: [extensionFactory],
          noSkills: true,
          noPromptTemplates: true,
          noThemes: true,
          noContextFiles: true,
        },
      });

      await services.resourceLoader.reload();

      return {
        ...(await createAgentSessionFromServices({
          services,
          sessionManager,
          sessionStartEvent,
          model: fakeModel,
          noTools: "all",
        })),
        services,
        diagnostics: services.diagnostics,
      };
    };

    const runtime = await createAgentSessionRuntime(createRuntime, {
      cwd,
      agentDir,
      sessionManager: SessionManager.create(cwd, agentDir),
    });

    const extensionErrors: unknown[] = [];

    const bindExtensions = async () => {
      await runtime.session.bindExtensions({
        uiContext: {
          notify: () => {},
          setEditorText: () => {},
          getEditorText: () => "",
        },
        onError: (error: unknown) => {
          extensionErrors.push(error);
        },
        commandContextActions: {
          waitForIdle: async () => {},
          newSession: (options: any = {}) =>
            runtime.newSession({
              ...options,
              withSession: async (replacementCtx: any) => {
                await options.withSession?.({
                  ...replacementCtx,
                  sendUserMessage: async (message: string) => {
                    runtime.session.sessionManager.appendMessage({
                      role: "user",
                      content: [{ type: "text", text: message }],
                      timestamp: Date.now(),
                    });
                  },
                });
              },
            }),
          fork: (entryId: string, options: any) => runtime.fork(entryId, options),
          navigateTree: (targetId: string, options: any) => runtime.session.navigateTree(targetId, options),
          switchSession: (sessionPath: string, options: any) => runtime.switchSession(sessionPath, options),
          reload: async () => {},
        },
      });
    };

    runtime.setRebindSession(async () => {
      await bindExtensions();
    });
    await bindExtensions();

    runtime.session.sessionManager.appendMessage({
      role: "user",
      content: [{ type: "text", text: "Seed context for handoff." }],
      timestamp: Date.now(),
    });

    await runtime.session.prompt("/handoff continue with the failing test");

    const replacementMessages = runtime.session.sessionManager
      .getBranch()
      .filter((entry: any) => entry.type === "message" && entry.message.role === "user")
      .map((entry: any) => entry.message);
    const lastUserMessage = replacementMessages.at(-1);
    const text = Array.isArray(lastUserMessage?.content)
      ? lastUserMessage.content.map((part: any) => part.text ?? "").join("\n")
      : String(lastUserMessage?.content ?? "");

    assert.deepEqual(extensionErrors, []);
    assert.match(text, /This session continues from a previous Pi session/);
    assert.match(text, /Read `.*\.handoff\/.*\.md`/);
    assert.match(text, /\n\ncontinue with the failing test$/);

    await runtime.dispose();
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(agentDir, { recursive: true, force: true });
  }
});
