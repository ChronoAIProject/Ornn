/**
 * SSE (Server-Sent Events) parser utility.
 * Parse buffered SSE text into individual event payloads.
 * Extracted from resolveStreamApi for shared use across stream consumers.
 * @module utils/sseParser
 */

/**
 * Parse buffered SSE text into individual event payloads.
 * Handles the `data: <json>\n\n` format.
 * Returns any incomplete trailing text as remainder.
 */
export function parseSseChunk<T = unknown>(buffer: string): { events: T[]; remainder: string } {
  const events: T[] = [];
  const blocks = buffer.split("\n\n");
  const remainder = blocks.pop() ?? "";

  for (const block of blocks) {
    const lines = block.split("\n");
    let data = "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        data += line.slice(6);
      } else if (line.startsWith("data:")) {
        data += line.slice(5);
      }
      // Skip event:/id:/comment lines
    }

    if (!data || data.trim() === "") continue;

    try {
      const parsed = JSON.parse(data) as T;
      events.push(parsed);
    } catch {
      // Malformed JSON -- skip
    }
  }

  return { events, remainder };
}
