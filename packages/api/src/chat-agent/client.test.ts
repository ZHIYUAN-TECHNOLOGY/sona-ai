import { expect, test } from "bun:test";

import { askOver, asAnswer, type ChatMessageLike } from "./client";

test("questions asked together each get their own answer; one that never comes back reads as a fixture", async () => {
  const finished: { current?: ChatMessageLike } = {};
  const sent: string[] = [];
  // The hook's sendMessage: settles once the answer has streamed, after onFinish gave it.
  const send = async (text: string) => {
    sent.push(text);
    await new Promise(resolve => setTimeout(resolve, text === "slow" ? 20 : 1));
    if (text === "down") throw new Error("socket closed");
    finished.current = { role: "assistant", parts: [{ type: "text", text: `answer to ${text} [2]` }], metadata: { source: "model", grounded: true } };
  };
  const ask = askOver(send, finished);
  const [slow, fast, down] = await Promise.all([ask("slow"), ask("fast"), ask("down")]);
  expect(sent).toEqual(["slow", "fast", "down"]);
  expect([slow.answer, fast.answer]).toEqual(["answer to slow", "answer to fast"]);
  expect(slow).toMatchObject({ source: "model", grounded: true, urgent: false, sources: [], doctors: [] });
  expect(down).toEqual(asAnswer({ role: "assistant", parts: [] }));
  expect(down).toMatchObject({ answer: "", source: "fixture" });
});
