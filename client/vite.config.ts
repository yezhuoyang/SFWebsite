import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * No same-origin proxy — the chapter iframe loads coq.vercel.app
 * directly. Reasons we tried and abandoned a same-origin proxy:
 *
 *  - wacoq does many cross-origin-blocked things (Web Workers, XHR for
 *    `*.symb.json`, MIME-strict WASM compilation) that all require
 *    same-origin to succeed. Easy fix: proxy everything through us.
 *  - But: SharedArrayBuffer (which wacoq's worker uses) requires the
 *    document to be cross-origin-isolated. That requires COOP+COEP on
 *    BOTH the parent and the iframe — and once both are
 *    require-corp, every subresource needs CORP, including
 *    Vite's own dev hot-reload responses.
 *  - Multiple combinations of these constraints either left the iframe
 *    on chrome-error or hung the worker silently.
 *
 * Direct embedding works because coq.vercel.app's whole pipeline is
 * self-consistent: same origin for the iframe doc + worker + .wasm
 * stubs + .coq-pkg, and they ship matching COOP/COEP/CORP. We treat
 * it as a black box and let the user interact with it via the iframe.
 *
 * Trade-off: cross-origin means React can't read
 * `iframe.contentWindow.coq` directly. Grading and the AI tutor have
 * to use a different input path (e.g. a paste textarea) — that's a
 * follow-up change.
 */

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        ws: true,
      },
    },
  },
})
