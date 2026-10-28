import { readServerConfiguration, type ServerConfiguration, type ServerSettings } from '../../src/server/configuration';

/**
 * Raw server settings from AA2M_SERVER_COMMAND, AA2M_SERVER_ARGS (JSON array) and AA2M_SERVER_CWD.
 * Unset variables fall back to `fallback`. Stays free of `vscode` so the smoke test can use it.
 */
export function serverSettingsFromEnvironment(fallback: ServerSettings = {}): ServerSettings {
  const args = process.env.AA2M_SERVER_ARGS;
  return {
    command: process.env.AA2M_SERVER_COMMAND ?? fallback.command,
    args: args ? JSON.parse(args) as unknown : fallback.args,
    cwd: process.env.AA2M_SERVER_CWD ?? fallback.cwd
  };
}

export function serverConfigurationFromEnvironment(fallback: ServerSettings = {}): ServerConfiguration {
  return readServerConfiguration(serverSettingsFromEnvironment(fallback));
}
