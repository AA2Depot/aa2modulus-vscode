// The notification that sums up a module command's findings. The server
// publishes located findings as diagnostics and logs every finding to the
// output channel, so the client only counts them.
import type { CommandFindings } from './protocol';

/** The command that reported the findings. */
export type CommandOrigin = 'compile' | 'decompile';

export interface CommandSummary {
  severity: 'error' | 'warning';
  message: string;
  /** Some findings are in the Problems panel, so the notification offers Show Problems. */
  showProblems: boolean;
}

function counted(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * The notification for a command's findings, or undefined when there are no
 * errors or warnings. Errors take precedence over warnings in the count.
 */
export function summarizeCommandFindings(origin: CommandOrigin, findings: CommandFindings): CommandSummary | undefined {
  const { errors, warnings } = findings;
  if (!errors && !warnings) {
    return undefined;
  }
  const unlocated = findings.unlocated.filter(finding => finding.severity !== 'info').length;
  const showProblems = errors + warnings > unlocated;
  const where = showProblems
    ? 'See the Problems panel and the language server output for details.'
    : 'See the language server output for details.';
  return {
    severity: errors ? 'error' : 'warning',
    message: `AA2M ${origin} reported ${errors ? counted(errors, 'error') : counted(warnings, 'warning')}. ${where}`,
    showProblems
  };
}
