/** Drop HTML comments by index, including overlapping `<!--` leftovers. */
export function stripHtmlComments(value: string): string {
  let current = value;
  while (true) {
    const start = current.indexOf("<!--");
    if (start < 0) return current;
    const end = current.indexOf("-->", start + 4);
    if (end < 0) return current.slice(0, start);
    current = `${current.slice(0, start)}${current.slice(end + 3)}`;
  }
}

/** Drop `<...>` tags by index so nested `<script` prefixes cannot survive one pass. */
export function stripHtmlTags(value: string): string {
  let current = value;
  while (true) {
    const start = current.indexOf("<");
    if (start < 0) return current;
    const end = current.indexOf(">", start + 1);
    if (end < 0) return current.slice(0, start);
    current = `${current.slice(0, start)}${current.slice(end + 1)}`;
  }
}
