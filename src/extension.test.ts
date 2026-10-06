import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyPendingSessionCarry, createHandoffCommand } from "./command.ts";

describe("handoff command", () => {
  it("declares argument support, keeps the session model and thinking level for the new session, and sends the continuation prompt", async () => {
    const sentMessages: string[] = [];
    const events: string[] = [];
    const sessionModel = { provider: "test-provider", id: "session-model" };
    const pi: any = {
      exec: async () => ({ code: 0, stdout: "" }),
      getSessionName: () => "Test Session",
      setModel: async (model: any) => {
        events.push(`setModel:${model.provider}/${model.id}`);
        return true;
      },
      setThinkingLevel: (level: string) => {
        events.push(`setThinkingLevel:${level}`);
      },
    };

    const completion = async () => ({
      content: [{ type: "text", text: "# Generated handoff" }],
    });

    const registeredCommand = createHandoffCommand(pi, completion as any);

    assert.equal(typeof registeredCommand.getArgumentCompletions, "function");

    const ctx: any = {
      waitForIdle: async () => {},
      hasUI: true,
      ui: {
        notify: () => {},
      },
      model: sessionModel,
      thinkingLevel: "high",
      modelRegistry: {
        getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "test-key", headers: {} }),
      },
      sessionManager: {
        getBranch: () => [
          {
            type: "message",
            message: {
              role: "user",
              content: [{ type: "text", text: "Prepare a handoff" }],
            },
          },
        ],
        getSessionFile: () => "/sessions/current.jsonl",
        getSessionName: () => "Fallback Session",
        getSessionId: () => "session-123",
      },
      cwd: "/tmp/pi-handoff-test",
      // Mirrors the host runtime: session_start for the replacement session runs
      // before withSession, and the extension re-applies the carried model there.
      newSession: async ({ withSession }: any) => {
        await applyPendingSessionCarry(pi, { ui: { notify: () => {} } });
        await withSession({
          ui: { notify: () => {} },
          sendUserMessage: async (message: string) => {
            events.push("sendUserMessage");
            sentMessages.push(message);
          },
        });
        return { cancelled: false };
      },
    };

    await registeredCommand.handler("continue with the failing test", ctx);

    assert.equal(sentMessages.length, 1);
    assert.match(sentMessages[0], /Read `\/tmp\/pi-handoff-test\/\.handoff\/test-session\.md`/);
    assert.match(sentMessages[0], /\n\ncontinue with the failing test$/);
    assert.deepEqual(events, [
      "setModel:test-provider/session-model",
      "setThinkingLevel:high",
      "sendUserMessage",
    ]);
  });
});
