import { COMMANDS } from '../shared/ids';
import { serverLabel, type ServerStatus } from './status';

export type StatusSeverity = 'information' | 'warning' | 'error';

export interface StatusPresentation {
  text: string;
  detail: string;
  severity: StatusSeverity;
  busy: boolean;
  command: { id: string; title: string };
}

const RESTART = { id: COMMANDS.restartServer, title: 'Restart' };
const SELECT = { id: COMMANDS.selectServer, title: 'Select Executable…' };
const TRUST = { id: 'workbench.trust.manage', title: 'Manage Trust' };

/** Language status item content for a server status. */
export function describeStatus(status: ServerStatus): StatusPresentation {
  const server = serverLabel(status);
  const join = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(' · ');
  switch (status.state) {
    case 'untrusted':
      return {
        text: 'AA2M: Restricted',
        detail: 'Trust the workspace to start the language server',
        severity: 'warning',
        busy: false,
        command: TRUST
      };
    case 'starting':
      return { text: 'AA2M: Starting', detail: join(status.command), severity: 'information', busy: true, command: RESTART };
    case 'ready':
      return {
        text: 'AA2M: Ready',
        detail: join(status.warning, server, status.command),
        severity: status.warning ? 'warning' : 'information',
        busy: false,
        command: RESTART
      };
    case 'failed':
      return {
        text: status.missingExecutable ? 'AA2M: Server not found' : 'AA2M: Failed to start',
        detail: join(status.detail, status.command),
        severity: 'error',
        busy: false,
        command: SELECT
      };
    case 'crashed':
      return {
        text: 'AA2M: Stopped unexpectedly',
        detail: join(status.detail, server, status.command),
        severity: 'error',
        busy: false,
        command: RESTART
      };
    case 'stopped':
      return { text: 'AA2M: Stopped', detail: join(status.command), severity: 'information', busy: false, command: RESTART };
  }
}
