/** The text of an OpenAI-style streamed chat reply (server-sent events), as it arrives. */
export async function* deltas(body: ReadableStream<Uint8Array>, finished?: () => void): AsyncGenerator<string> {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let pending = "";
  try {
    for (let read = await reader.read(); !read.done; read = await reader.read()) {
      const lines = (pending + read.value).split("\n");
      pending = lines.pop()!;
      for (const line of lines) {
        const data = line.startsWith("data:") ? line.slice(5).trim() : "";
        if (!data || data === "[DONE]") continue;
        const text = (JSON.parse(data) as { choices?: { delta?: { content?: unknown } }[] }).choices?.[0]?.delta?.content;
        if (typeof text === "string" && text) yield text;
      }
    }
    finished?.();
  } finally {
    // An interrupted turn stops reading here: cancelling the body closes the request, so vLLM stops writing.
    await reader.cancel().catch(() => {});
  }
}
