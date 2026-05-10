import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createHandoffCommand } from "./command.ts";

describe("handoff command", () => {
  it("declares argument support and sends the continuation prompt with the user's argument to the new session", async () => {
    const pi: any = {
      exec: async () => ({ code: 0, stdout: "" }),
      getSessionName: () => "Test Session",
    };

    const completion = async () => ({
      content: [{ type: "text", text: "# Generated handoff" }],
    });

    const registeredCommand = createHandoffCommand(pi, completion as any);

    assert.equal(typeof registeredCommand.getArgumentCompletions, "function");

    const sentMessages: string[] = [];
    const ctx: any = {
      waitForIdle: async () => {},
      hasUI: true,
      ui: {
        notify: () => {},
      },
      model: { provider: "test-provider" },
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
      newSession: async ({ withSession }: any) => {
        await withSession({
          ui: { notify: () => {} },
          sendUserMessage: async (message: string) => {
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
  });
});
