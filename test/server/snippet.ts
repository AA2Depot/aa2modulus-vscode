/**
 * The text an editor inserts for an LSP snippet when the user accepts every
 * default: placeholders keep their default, choices their first option, tab
 * stops become empty, and escapes are removed.
 */
export function expandSnippet(snippet: string): string {
  let text = snippet;
  // Innermost placeholders first, so nested defaults expand too.
  for (let previous = ''; previous !== text;) {
    previous = text;
    text = text.replace(/\$\{\d+:((?:\\.|[^${}\\])*)\}/g, '$1');
  }
  return text
    .replace(/\$\{\d+\|((?:\\.|[^,|\\])*)[^|]*\|\}/g, '$1')
    .replace(/\$\{\d+\}|\$\d+/g, '')
    .replace(/\\([$}\\,|])/g, '$1');
}
