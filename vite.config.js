import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: ["roughjs"],
  },
  esbuild: {
    // Diagnostic chatter should not ship. console.error/warn are kept so real
    // failures still surface in a browser console during an event.
    pure: ["console.debug", "console.log", "console.trace"],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // All four Firebase entry points are listed explicitly: leaving auth
          // and functions out let their shared internals land in the entry
          // chunk instead.
          //
          // Firestore is split from the rest because on its own it is most of
          // the SDK — as one chunk the four together came to 556 kB, over
          // Rollup's 500 kB warning threshold, and there is nothing to delete:
          // every route needs auth, callables and live subscriptions, and the
          // polling fallback rules out the lite build. Split this way each
          // chunk clears the threshold, the total is the same to within half a
          // kilobyte gzipped, and a Firestore-only SDK bump stops invalidating
          // the auth bundle.
          "firebase-core": ["firebase/app", "firebase/auth", "firebase/functions"],
          "firebase-firestore": ["firebase/firestore"],
          react: ["react", "react-dom"],
          // wired-elements pulls in roughjs and its canvas renderer, which is a
          // drawing library the entry chunk has no reason to carry.
          sketch: ["wired-elements", "roughjs"],
        },
      },
    },
  },
});
