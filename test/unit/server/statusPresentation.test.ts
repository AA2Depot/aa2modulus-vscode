import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ServerStatus } from '../../../src/server/status';
import { describeStatus, type StatusPresentation } from '../../../src/server/statusPresentation';

const RESTART = { id: 'aa2m.restartServer', title: 'Restart' };
const SELECT = { id: 'aa2m.selectServer', title: 'Select Executable…' };
const TRUST = { id: 'workbench.trust.manage', title: 'Manage Trust' };

test('each state shows its text, detail, severity and next useful action', () => {
  const cases: [ServerStatus, StatusPresentation][] = [
    [{ state: 'untrusted' }, {
      text: 'AA2M: Restricted', detail: 'Trust the workspace to start the language server',
      severity: 'warning', busy: false, command: TRUST
    }],
    [{ state: 'starting', command: 'aa2modulus lsp-server' }, {
      text: 'AA2M: Starting', detail: 'aa2modulus lsp-server', severity: 'information', busy: true, command: RESTART
    }],
    [{ state: 'ready', command: '/opt/aa2modulus lsp-server', serverName: 'aa2modulus', serverVersion: '0.1.0' }, {
      text: 'AA2M: Ready', detail: 'aa2modulus 0.1.0 · /opt/aa2modulus lsp-server',
      severity: 'information', busy: false, command: RESTART
    }],
    [{ state: 'ready', warning: 'Server too old for module commands' }, {
      text: 'AA2M: Ready', detail: 'Server too old for module commands', severity: 'warning', busy: false, command: RESTART
    }],
    [{ state: 'failed', missingExecutable: true, detail: 'spawn aa2modulus ENOENT', command: 'aa2modulus lsp-server' }, {
      text: 'AA2M: Server not found', detail: 'spawn aa2modulus ENOENT · aa2modulus lsp-server',
      severity: 'error', busy: false, command: SELECT
    }],
    [{ state: 'failed', detail: 'timeout' }, {
      text: 'AA2M: Failed to start', detail: 'timeout', severity: 'error', busy: false, command: SELECT
    }],
    [{ state: 'crashed', detail: 'The server connection closed.' }, {
      text: 'AA2M: Stopped unexpectedly', detail: 'The server connection closed.',
      severity: 'error', busy: false, command: RESTART
    }],
    [{ state: 'stopped' }, { text: 'AA2M: Stopped', detail: '', severity: 'information', busy: false, command: RESTART }]
  ];
  for (const [status, expected] of cases) {
    assert.deepEqual(describeStatus(status), expected, JSON.stringify(status));
  }
});
