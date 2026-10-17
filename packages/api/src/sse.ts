/**
 * The text of an OpenAI-style streamed chat reply (server-sent events), as it arrives. `finished` runs once the stream
 * ends by itself, with the reply's `finish_reason` when the stream gave one ("length": cut off at the token limit), so a
 * streamed answer knows it was cut the same way a whole one does.
 */
export async function* deltas(body: ReadableStream<Uint8Array>, finished?: (reason?: string) => void): AsyncGenerator<string> {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let pending = "", reason: string | undefined;
  try {
    for (let read = await reader.read(); !read.done; read = await reader.read()) {
      const lines = (pending + read.value).split("\n");
      pending = lines.pop()!;
      for (const line of lines) {
        const data = line.startsWith("data:") ? line.slice(5).trim() : "";
        if (!data || data === "[DONE]") continue;
        const choice = (JSON.parse(data) as { choices?: { delta?: { content?: unknown }; finish_reason?: unknown }[] }).choices?.[0];
        if (typeof choice?.finish_reason === "string") reason = choice.finish_reason;
        const text = choice?.delta?.content;
        if (typeof text === "string" && text) yield text;
      }
    }
    finished?.(reason);
  } finally {
    // An interrupted turn stops reading here: cancelling the body closes the request, so vLLM stops writing.
    await reader.cancel().catch(() => {});
  }
}
