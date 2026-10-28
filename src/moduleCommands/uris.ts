// URI helpers for module commands, on URI strings so they stay editor-free.

/** The last path segment of a URI, decoded. */
export function uriFileName(uri: string): string {
  const segment = uri.replace(/[?#].*$/s, '').replace(/\/+$/, '').split('/').pop() ?? '';
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
