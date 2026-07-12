// Turn note Markdown into readable speech text: strip the syntax so TTS reads prose, not
// "hash hash Objective star star vitals". Headings become spoken labels ("Objective."),
// bullets lose their dash, emphasis/links/code are unwrapped. Pure + unit-tested.

function stripInline(s: string): string {
  return s
    .replace(/\[(.*?)\]\((?:.*?)\)/g, "$1") // [text](url) → text
    .replace(/\*\*(.*?)\*\*/g, "$1") // bold
    .replace(/\*(.*?)\*/g, "$1") // italic
    .replace(/__(.*?)__/g, "$1")
    .replace(/_(.*?)_/g, "$1")
    .replace(/~~(.*?)~~/g, "$1") // strikethrough
    .replace(/`(.*?)`/g, "$1") // inline code
    .trim();
}

/** Convert note Markdown to a single readable string for text-to-speech. */
export function noteToSpeech(markdown: string): string {
  const out: string[] = [];
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) {
      const label = stripInline(heading[1]).replace(/[.:]+$/, "");
      if (label) out.push(`${label}.`); // "Objective." — a spoken section break
      continue;
    }
    const body = stripInline(line.replace(/^[-*+]\s+/, "")); // drop bullet marker
    if (body) out.push(body);
  }
  return out.join(" ").replace(/\s+/g, " ").trim();
}
