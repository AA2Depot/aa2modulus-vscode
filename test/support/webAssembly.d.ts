// vscode-oniguruma 2.0.1's typings name two WebAssembly types. `@types/node`
// stays at the engine floor (20), which does not declare that namespace, and
// the DOM library would leak browser globals into the tests. The grammar test
// passes the wasm bytes, so these types are never used.
declare namespace WebAssembly {
  type ImportValue = unknown;
  type WebAssemblyInstantiatedSource = unknown;
}
