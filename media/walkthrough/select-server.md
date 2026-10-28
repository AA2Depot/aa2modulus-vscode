# Set up the language server

Highlighting works on its own. Diagnostics, completion, hover, rename and
compiling need the `aa2modulus` language server. Pick one of these.

## Download a release

**Download Server** shows the
[releases](https://github.com/AA2Depot/AA2Modulus/releases), newest first.
Pick one and the extension downloads it, checks it and starts using it. Run
**AA2M: Download Language Server…** again whenever you want another version.

There are builds for Linux and Windows on x64. In a WSL, SSH or other remote
window, the server is installed on the remote machine.

## Use an executable you already have

**Select Existing Executable** lets you pick the file yourself
(`aa2modulus.exe` on Windows).

## Afterwards

The path is saved as `aa2m.server.command` in your User settings. Open an AA2M
file and check the **AA2M** item in the status bar to see the server version
and whether it is ready. If a workspace's `.vscode/settings.json` sets a
different path, that one wins and the extension tells you.
