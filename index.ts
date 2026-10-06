import { complete } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { applyPendingSessionCarry, createHandoffCommand, type CompletionFunction } from "./src/command.ts";

export const registerHandoffExtension = (pi: ExtensionAPI, completion: CompletionFunction = complete as CompletionFunction) => {
  pi.on("session_start", async (event, ctx) => {
    if (event.reason !== "new") return;
    await applyPendingSessionCarry(pi, ctx);
  });

  pi.registerCommand("handoff", createHandoffCommand(pi, completion));
};

export default function (pi: ExtensionAPI) {
  registerHandoffExtension(pi);
}
