#!/usr/bin/env bun

import { createProgram } from "./commands.js";

await createProgram().parseAsync(process.argv);
