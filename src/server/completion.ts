export function addParameterHelp(item: {
  insertText?: string | { value: string };
  command?: { command: string; title: string };
}): void {
  const text = item.insertText;
  if (!item.command && typeof text === 'object' && text.value.includes('(') && /\$(?:[1-9]|\{[1-9])/.test(text.value)) {
    item.command = { command: 'editor.action.triggerParameterHints', title: 'Parameter Help' };
  }
}
