import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

/**
 * Builds the client as one self-contained IIFE so `npm run test:smoke` can
 * evaluate the entire module graph in jsdom.
 *
 * Not a real build. It exists because `vite build` succeeding says nothing about
 * whether the app can actually start: a module-scope error (a const read before
 * its initializer, a property off an undefined global) compiles perfectly and
 * then renders a blank page.
 */
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "node_modules/.smoke",
    emptyOutDir: true,
    rollupOptions: {
      output: { entryFileNames: "app.js", format: "iife", inlineDynamicImports: true },
    },
  },
});
