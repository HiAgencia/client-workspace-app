// What escapes the design system, counted on every `pnpm check`. Each count has a cap that only goes down; today every
// cap is zero. Exits 1 listing each finding, 0 with the counts it read.
//   - a stock icon set, imported by any file or declared in package.json: the product draws its own, in
//     src/components/ui/icons.tsx, where each concept takes its one icon. Each run first proves the rule on a planted
//     import and its clean twin, so a rule that stopped matching fails instead of reading zero;
//   - native pickers in the screens (select, date, checkbox): the product's own controls replace them;
//   - color literals outside the roles (src/app/styles/tokens.css);
//   - text sizes and colors written as Tailwind utilities instead of the roles' classes;
//   - a `:hover` rule outside `@media (hover: hover)`, where a touch screen would keep it lit;
//   - the product's name written outside `src/lib/product.ts`, its one place: the final name changes there alone.
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
const isCode = (f) => /\.(tsx?|jsx?|mjs|cjs|mts|cts)$/.test(f);
const code = all.filter((f) => isCode(f) && !/\.test\./.test(f));
// Every file of the app's own, tests and scripts included, for the rule that no file imports a stock icon set.
const ownCode = ["src", "scripts", "tests"]
  .map((dir) => join(root, dir))
  .filter((dir) => statSync(dir, { throwIfNoEntry: false })?.isDirectory())
  .flatMap((dir) => files(dir))
  .filter(isCode);
const css = all.filter((f) => f.endsWith(".css"));
const rel = (f) => relative(root, f).split(sep).join("/");
const strip = (text) => text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[^:])\/\/.*$/gm, "$1");
const productName = /PRODUCT_NAME = "([^"]+)"/.exec(readFileSync(join(src, "lib", "product.ts"), "utf8"))?.[1];

const checks = [
  {
    name: "stock icon sets",
    cap: 0,
    // The product's icons are its own drawing: no file imports a stock set and package.json declares none.
    find: () => [
      ...ownCode.flatMap((file) => stockImports(rel(file), readFileSync(file, "utf8"))),
      ...stockDependencies("package.json", readFileSync(join(root, "package.json"), "utf8")),
    ],
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
  {
    name: "the product's name outside src/lib/product.ts",
    cap: 0,
    // A name the check could not read is a finding, never a clean zero.
    find: () =>
      productName
        ? findIn(code.filter((f) => rel(f) !== "src/lib/product.ts"), new RegExp(productName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))
        : ["src/lib/product.ts: PRODUCT_NAME not found"],
  },
];

// The stock icon sets, by package name: line sets and their look-alikes, whole families under a scope included. Every
// name also takes any path inside its package (`<package>/dynamic`, `<package>/dist/...`), by the one suffix at the end.
const STOCK_ICONS =
  /^(?:lucide(?:-[\w-]+)?|@lucide\/.+|heroicons|@heroicons\/.+|react-feather|feather-icons|@tabler\/icons(?:-[\w-]+)?|react-icons|@phosphor-icons\/.+|phosphor-react|phosphor-icons|@radix-ui\/react-icons|@iconify(?:-icon)?\/.+|iconify-icon|unplugin-icons|~icons\/.+|@mui\/icons-material|@fortawesome\/.+|@ant-design\/icons(?:-svg)?|ionicons|react-ionicons|bootstrap-icons|react-bootstrap-icons|@primer\/octicons(?:-react)?|@remixicon\/.+|remixicon|boxicons|@carbon\/icons(?:-react)?|@mdi\/.+|material-icons|material-symbols|@material-symbols\/.+|iconoir(?:-react)?|@hugeicons\/.+|hugeicons-react|@untitled-ui\/icons-react|akar-icons|css\.gg|eva-icons|line-awesome|react-line-awesome|@iconscout\/.+|@icons-pack\/.+|simple-icons)(?:\/.+)?$/;
// Where a module names another: `from "x"`, `import "x"`, `import("x")`, `require("x")`.
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']([^"']+)["']/g;

function stockImports(name, text) {
  const found = [];
  strip(text)
    .split("\n")
    .forEach((line, index) => {
      for (const match of line.matchAll(SPECIFIER)) if (STOCK_ICONS.test(match[1])) found.push(`${name}:${index + 1} ${match[1]}`);
    });
  return found;
}

function stockDependencies(name, text) {
  const manifest = JSON.parse(text);
  return ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"].flatMap((field) =>
    Object.keys(manifest[field] ?? {})
      .filter((pkg) => STOCK_ICONS.test(pkg))
      .map((pkg) => `${name} ${field}: ${pkg}`),
  );
}

// The rule proven before it is trusted: a planted import of each kind is found, and its twin, the product's own module
// written the same way, is not. The names are joined at run time, so this file never imports them itself.
function proveStockRule() {
  const q = '"';
  const lucide = ["lucide", "react"].join("-");
  const planted = [
    `import { Check } from ${q}${lucide}${q};`,
    `import ${q}@heroicons/react/24/outline${q};`,
    `const icons = await import(${q}@tabler/icons-react${q});`,
    `const { FiX } = require(${q}react-icons/fi${q});`,
    `export { Icon } from ${q}@iconify/react${q};`,
    `import { DynamicIcon } from ${q}${lucide}/dynamic${q};`,
    `import IconX from ${q}@tabler/icons-react/dist/esm/icons/IconX${q};`,
  ];
  const twins = [
    `import { CheckIcon } from ${q}@/components/ui/icons${q};`,
    `import ${q}./icons.css${q};`,
    `const lucideLike = ${q}${lucide}${q};`,
    `import { DynamicIcon } from ${q}@/components/ui/icons/dynamic${q};`,
  ];
  const misses = [];
  planted.forEach((line, i) => stockImports(`planted ${i + 1}`, line).length !== 1 && misses.push(`planted import not found: ${line}`));
  twins.forEach((line, i) => stockImports(`twin ${i + 1}`, line).length !== 0 && misses.push(`clean twin found: ${line}`));
  if (stockDependencies("planted package.json", JSON.stringify({ dependencies: { [lucide]: "1.0.0" } })).length !== 1)
    misses.push("planted dependency not found");
  if (stockDependencies("twin package.json", JSON.stringify({ dependencies: { react: "19.0.0" } })).length !== 0)
    misses.push("clean dependency found");
  return misses;
}

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
const misses = proveStockRule();
if (misses.length) failed = true;
console.log(`${misses.length ? "FAIL" : "OK  "} stock icon rule on its planted cases and twins: ${misses.length} misses`);
for (const line of misses) console.log(`  ${line}`);
for (const check of checks) {
  const found = check.find();
  const over = found.length > check.cap;
  if (over) failed = true;
  console.log(`${over ? "FAIL" : "OK  "} ${check.name}: ${found.length} (cap ${check.cap})`);
  if (over) for (const line of found) console.log(`  ${line}`);
}
console.log(`read ${code.length} code files and ${css.length} stylesheets`);
process.exitCode = failed ? 1 : 0;
