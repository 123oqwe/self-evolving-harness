// ESM loader hook: map `.js` imports to `.ts` source so plain `node` can run
// the workspace TS packages (type-stripping is built-in on Node 24) without a
// build step. TypeScript's `moduleResolution: Bundler` lets `.js` specifiers
// resolve to `.ts` files; Node's native resolver does not, so we shim it.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export async function resolve(specifier, context, nextResolve) {
  try {
    const r = await nextResolve(specifier, context);
    if (r && r.url && r.url.startsWith("file:") && r.url.endsWith(".js")) {
      const tsUrl = r.url.slice(0, -3) + ".ts";
      if (!existsSync(fileURLToPath(r.url)) && existsSync(fileURLToPath(tsUrl))) {
        return { ...r, url: tsUrl };
      }
    }
    return r;
  } catch (err) {
    // nextResolve threw (e.g. ERR_MODULE_NOT_FOUND for a `.js` that's actually `.ts`).
    // Try rewriting the specifier's `.js`→`.ts` and re-resolve.
    if (typeof specifier === "string" && specifier.endsWith(".js")) {
      const tsSpec = specifier.slice(0, -3) + ".ts";
      return nextResolve(tsSpec, context);
    }
    throw err;
  }
}
