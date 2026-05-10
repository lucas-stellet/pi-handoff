import { complete } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createHandoffCommand, type CompletionFunction } from "./src/command.ts";

export const registerHandoffExtension = (pi: ExtensionAPI, completion: CompletionFunction = complete as CompletionFunction) => {
  pi.registerCommand("handoff", createHandoffCommand(pi, completion));
};

export default function (pi: ExtensionAPI) {
  registerHandoffExtension(pi);
}
