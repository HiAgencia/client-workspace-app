import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

// The suite reads the project's own `.dev.vars`, over whatever the machine's environment holds: a variable another
// project left in the system must never point these tests at a different database.
const file = new URL("../../.dev.vars", import.meta.url);
if (existsSync(file)) {
  for (const [name, value] of Object.entries(parseEnv(readFileSync(file, "utf8")))) {
    if (value !== undefined) process.env[name] = value;
  }
}
