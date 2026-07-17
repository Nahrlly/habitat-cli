#!/usr/bin/env bun

import { createProgram } from "./commands.js";
import { ensureLocalApi } from "./local-api.js";

await ensureLocalApi();
await createProgram().parseAsync(process.argv);
