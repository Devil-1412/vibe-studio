// Pure (no DOM), so the self-test can run it.

/** A quote block for a dropped message: "> " on every line, long ones cut. */
export function quoteText(text: string, max = 1500): string {
  const cut = text.length > max ? `${text.slice(0, max).trimEnd()}…` : text.trimEnd();
  return cut.split('\n').map((l) => `> ${l}`.trimEnd()).join('\n');
}
