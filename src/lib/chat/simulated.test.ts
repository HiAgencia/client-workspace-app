import type { LanguageModelV4Prompt, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";
import { simulatedModel } from "./simulated";

const SYSTEM = { role: "system" as const, content: "Now: Wednesday (time zone UTC)." };
const asked = { role: "user" as const, content: [{ type: "text" as const, text: "What is pending today?" }] };

async function parts(prompt: LanguageModelV4Prompt): Promise<LanguageModelV4StreamPart[]> {
  const { stream } = await simulatedModel().doStream({ prompt } as Parameters<ReturnType<typeof simulatedModel>["doStream"]>[0]);
  const out: LanguageModelV4StreamPart[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return out;
    out.push(value);
  }
}

const said = (chunks: LanguageModelV4StreamPart[]) => chunks.flatMap((chunk) => (chunk.type === "text-delta" ? [chunk.delta] : [])).join("");

function afterRead(groups: Record<string, unknown>): LanguageModelV4Prompt {
  return [
    SYSTEM,
    asked,
    { role: "assistant", content: [{ type: "tool-call", toolCallId: "c1", toolName: "get_tasks", input: {} }] },
    { role: "tool", content: [{ type: "tool-result", toolCallId: "c1", toolName: "get_tasks", output: { type: "json", value: { groups } } }] },
  ] as LanguageModelV4Prompt;
}

const row = (title: string) => ({ id: title, title, mail: null });

describe("the simulated model asked what is pending today", () => {
  it("first reads the person's day", async () => {
    const chunks = await parts([SYSTEM, asked]);
    const call = chunks.find((chunk) => chunk.type === "tool-call");
    expect(call).toMatchObject({ toolName: "get_tasks" });
    expect(JSON.parse((call as { input: string }).input)).toEqual({ today: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
  });

  it("with nothing late or due, says so", async () => {
    expect(said(await parts(afterRead({ overdue: { tasks: [] }, today: { tasks: [] } })))).toBe("Nothing is due today, and nothing is late.");
  });

  it("says what is late, then what is due, each title as plain text, and starts with the first late one", async () => {
    const answer = said(
      await parts(
        afterRead({
          overdue: { tasks: [row("Send the October invoices")] },
          today: { tasks: [row("Call Maya"), row("[Review the checkout pull request](https://code.example/pull/48)")] },
        }),
      ),
    );
    expect(answer).toBe("Late: Send the October invoices. Due today: Call Maya; Review the checkout pull request. Start with “Send the October invoices”.");
    expect(answer).not.toMatch(/[[\]()"]/);
  });

  it("with only a linked task due, starts with its words, not its link", async () => {
    const answer = said(await parts(afterRead({ overdue: { tasks: [] }, today: { tasks: [row("[Review the pull request](https://code.example/pull/48)")] } })));
    expect(answer).toBe("Due today: Review the pull request. Start with “Review the pull request”.");
  });
});
