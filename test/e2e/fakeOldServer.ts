// A stand-in language server for oldServer.test.ts: it answers `initialize`
// with contract version 1, the module commands and no built-in pages, and
// every other request with null. It knows nothing about AA2M.
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from 'vscode-languageserver-protocol/node';

const connection = createMessageConnection(
  new StreamMessageReader(process.stdin),
  new StreamMessageWriter(process.stdout)
);

connection.onRequest('initialize', () => ({
  capabilities: {
    executeCommandProvider: { commands: ['aa2modulus.compileDocument', 'aa2modulus.decompileModule'] },
    experimental: { aa2modulus: { contractVersion: 1 } }
  },
  serverInfo: { name: 'fake old server', version: '0.0.0' }
}));
connection.onRequest(() => null);
connection.onNotification('exit', () => process.exit(0));
connection.listen();
