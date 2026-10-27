// What escapes the design system, counted on every `pnpm check`. Each count has a cap that only goes down; today every
// cap is zero. Exits 1 listing each finding, 0 with the counts it read.
//   - icons from a stock set (the product draws its own marks or says it in words);
//   - native pickers in the screens (select, date, checkbox): the product's own controls replace them;
//   - color literals outside the roles (src/app/styles/tokens.css);
//   - text sizes and colors written as Tailwind utilities instead of the roles' classes;
//   - a `:hover` rule outside `@media (hover: hover)`, where a touch screen would keep it lit.
// Usage: node scripts/check-system.mjs
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const src = join(root, "src");

function files(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files(path, out);
    else out.push(path);
  }
  return out;
}

const all = files(src);
const code = all.filter((f) => /\.(tsx?|jsx?)$/.test(f) && !/\.test\./.test(f));
const css = all.filter((f) => f.endsWith(".css"));
const rel = (f) => relative(root, f).split(sep).join("/");
const strip = (text) => text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[^:])\/\/.*$/gm, "$1");

const checks = [
  {
    name: "stock icon sets",
    cap: 0,
    find: () => findIn(code, /lucide|heroicons|react-icons|@tabler\/icons|feather-icons/g),
  },
  {
    name: "native pickers in the screens",
    cap: 0,
    find: () => findIn(code.filter((f) => rel(f).startsWith("src/app/")), /<select\b|type=["']date["']|type=["']checkbox["']|type=["']radio["']/g),
  },
  {
    name: "color literals outside the roles",
    cap: 0,
    // Allowed: the roles themselves, and the browser bar's color in lib/theme.ts, which metadata cannot read from a CSS
    // variable (theme.test.ts holds it equal to the card's role).
    find: () =>
      findIn(
        [...code, ...css].filter((f) => !rel(f).endsWith("styles/tokens.css") && rel(f) !== "src/lib/theme.ts"),
        /#[0-9a-fA-F]{3,8}\b(?![\w-])|\b(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch)\(/g,
        (line) => !/^\s*(import|export \{)/.test(line),
      ),
  },
  {
    name: "Tailwind sizes and colors instead of roles",
    cap: 0,
    find: () =>
      findIn(
        code,
        /(?<![\w-])(?:text-(?:xs|sm|base|lg|xl|[2-9]xl)|text-\[|(?:bg|text|border|ring|outline|fill|stroke)-(?:white|black|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)\b)/g,
      ),
  },
  { name: ":hover outside (hover: hover)", cap: 0, find: hoverOutside },
];

function findIn(list, pattern, keep = () => true) {
  const found = [];
  for (const file of list) {
    const lines = strip(readFileSync(file, "utf8")).split("\n");
    lines.forEach((line, index) => {
      if (!keep(line)) return;
      for (const match of line.matchAll(pattern)) found.push(`${rel(file)}:${index + 1} ${match[0]}`);
    });
  }
  return found;
}

// Walks each stylesheet's blocks and reports a selector with `:hover` whose enclosing blocks include no hover query.
function hoverOutside() {
  const found = [];
  for (const file of css) {
    const text = strip(readFileSync(file, "utf8"));
    const stack = [];
    let start = 0;
    let line = 1;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (char === "\n") line++;
      if (char === "{") {
        const header = text.slice(start, i).trim();
        stack.push(header);
        if (/:hover/.test(header) && !stack.some((h) => /@media[^{]*\((?:any-)?hover:\s*hover\)/.test(h))) {
          found.push(`${rel(file)}:${line} ${header.split("\n").pop()}`);
        }
        start = i + 1;
      } else if (char === "}") {
        stack.pop();
        start = i + 1;
      } else if (char === ";") {
        start = i + 1;
      }
    }
  }
  return found;
}

let failed = false;
for (const check of checks) {
  const found = check.find();
  const over = found.length > check.cap;
  if (over) failed = true;
  console.log(`${over ? "FAIL" : "OK  "} ${check.name}: ${found.length} (cap ${check.cap})`);
  if (over) for (const line of found) console.log(`  ${line}`);
}
console.log(`read ${code.length} code files and ${css.length} stylesheets`);
process.exitCode = failed ? 1 : 0;
