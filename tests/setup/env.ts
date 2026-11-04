import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

const file = new URL("../../.dev.vars", import.meta.url);
if (existsSync(file)) {
  for (const [name, value] of Object.entries(parseEnv(readFileSync(file, "utf8")))) {
    if (value !== undefined) process.env[name] = value;
  }
}
