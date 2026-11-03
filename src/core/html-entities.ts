const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: "\"",
  apos: "'",
  nbsp: " "
};

/**
 * Decode the HTML character references MediaWiki resolves inside link targets,
 * so `[[User:A&#38;B|…]]` and `[[User:A&amp;B|…]]` both name the account `A&B`.
 * Unknown named references are left unchanged.
 */
export function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/giu, (match, body: string) => {
    if (body.startsWith("#")) {
      const codePoint = body[1] === "x" || body[1] === "X"
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      return Number.isInteger(codePoint) && codePoint > 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}
