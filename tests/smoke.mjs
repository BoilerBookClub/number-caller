// Evaluates the whole client module graph in a DOM, failing on any error thrown
// at module scope. `vite build` and eslint both miss these: the bundle compiles
// fine and the page then renders nothing.
import { readFileSync } from "node:fs";
import { JSDOM, VirtualConsole } from "jsdom";

const bundlePath = process.argv[2];
const errors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on("jsdomError", (e) => errors.push(`${e.message}\n${e.detail?.stack ?? ""}`));

const dom = new JSDOM(`<!doctype html><html><body><div id="root"></div></body></html>`, {
  pretendToBeVisual: true,
  runScripts: "outside-only",
  url: "http://localhost:5173/",
  virtualConsole,
});

const { window } = dom;
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
window.scrollTo = () => {};
window.fetch = () => new Promise(() => {});

try {
  window.eval(readFileSync(bundlePath, "utf8"));
} catch (error) {
  errors.push(`${error.name}: ${error.message}\n${error.stack ?? ""}`);
}

const fatal = errors.filter((message) =>
  /ReferenceError|before initialization|SyntaxError/.test(message),
);

if (fatal.length) {
  console.error("MODULE EVALUATION FAILED\n" + fatal.join("\n---\n").slice(0, 2000));
  process.exit(1);
}

const rendered = window.document.getElementById("root").innerHTML.length;
console.log(`module graph evaluated with no fatal error; #root received ${rendered} chars`);

process.exit(0);
