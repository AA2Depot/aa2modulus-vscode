// Stdio wrapper the lifecycle suite configures as the server command. It
// starts the real server, records its process id in AA2M_SERVER_PID_FILE so
// the suite can kill only that process, and forwards termination signals.
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const command = process.env.AA2M_SERVER_COMMAND;
const args = JSON.parse(process.env.AA2M_SERVER_ARGS || '[]') as string[];
const cwd = process.env.AA2M_SERVER_CWD || undefined;
const pidFile = process.env.AA2M_SERVER_PID_FILE;

if (!command || !pidFile) {
  process.stderr.write('AA2M test launcher needs AA2M_SERVER_COMMAND and AA2M_SERVER_PID_FILE.\n');
  process.exit(2);
}

if (path.resolve(command) === path.resolve(process.execPath)
    && args[0] && path.resolve(args[0]) === __filename) {
  process.stderr.write('AA2M test launcher refuses to launch itself.\n');
  process.exit(2);
}

const server = spawn(command, args, { cwd, shell: false, stdio: 'inherit' });
server.on('spawn', () => fs.writeFileSync(pidFile, String(server.pid)));
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(signal, () => {
    if (server.exitCode === null && server.signalCode === null) {
      server.kill(signal);
    }
  });
}
server.on('error', error => {
  process.stderr.write(String(error) + '\n');
  process.exitCode = 1;
});
server.on('exit', (code, signal) => {
  process.exit(signal ? 1 : (code ?? 1));
});
