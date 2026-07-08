#!/usr/bin/env node
// Dedicated SessionStart-hook entrypoint (AXI P7). Prints the kubeconfig-local
// context snapshot and nothing else - the SDK hook runner spawns a bare
// command with no args, and pointing it here (instead of at the default home
// view) guarantees ambient context never performs cluster API calls.
import { ctxCommand } from "../src/commands/ctx.js";

ctxCommand([])
  .then((output) => {
    process.stdout.write(`${output}\n`);
  })
  .catch(() => {
    // Ambient context must never break session start; degrade to silence.
    process.exitCode = 0;
  });
