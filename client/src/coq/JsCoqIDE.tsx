/**
 * Embeds jsCoq's classic IDE — same as coq.vercel.app's `scratchpad.html`,
 * but mounted inside our React shell.
 *
 * jsCoq's frontend is a self-contained Vue/jQuery/Bootstrap bundle that
 * takes over a single `#ide-wrapper` div: it injects its own DOM, owns
 * Codemirror 5, and manages its own event loop. We treat that div as
 * an opaque region — React only renders the empty mount + frame, and the
 * IDE bundle does the rest.
 *
 * Asset layout (served from /jscoq/):
 *   /jscoq/jscoq.js                       — entry, exports JsCoq
 *   /jscoq/dist/frontend/index.{js,css}   — the actual IDE bundle
 *   /jscoq/dist/wacoq_worker.js           — wacoq worker
 *   /jscoq/backend/wasm/*                 — WASM artifacts
 *   /jscoq/coq-pkgs/*.coq-pkg             — package archives
 *
 * `JsCoq.start({...})` derives `base_path` from the URL of jscoq.js, so
 * loading it from /jscoq/ resolves the worker and packages correctly.
 */

import { useEffect, useRef } from 'react';

// --- jsCoq's options object (subset of CoqManager opts; see
// node_modules/jscoq/frontend/classic/js/coq-manager.js).
interface JsCoqOpts {
  backend?: 'wa' | 'js';
  base_path?: string;
  pkg_path?: string;
  implicit_libs?: boolean;
  file_dialog?: boolean;
  init_pkgs?: string[];
  all_pkgs?: string[] | Record<string, string[]>;
  editor?: { mode?: Record<string, boolean>; theme?: string };
  theme?: 'light' | 'dark';
  prelaunch?: boolean;
  prelude?: boolean;
}

// Minimal shape of the resolved CoqManager (we only touch a few methods).
interface CoqMgr {
  provider: {
    snippets: Array<{ filename?: string; setValue?: (s: string) => void }>;
    load?: (url: string, fn?: string) => unknown;
  };
  openProject?: (name: string) => unknown;
  when_ready?: Promise<unknown>;
  coq: { interruptSetup: () => void };
  coqBoot: () => Promise<void> | void;
  reset: () => Promise<unknown>;
}

/**
 * jsCoq's own `CoqManager.reset()` has a race: after `coq.restart()` re-spawns
 * the worker, the new worker fires `Boot`, which triggers `Manager.coqBoot()`
 * (it's still in `coq.observers`). That handler kicks off its own
 * `loadDeps(init_pkgs).then(coqInit)` while `reset()` is *also* about to do
 * `loadDeps(pkgs).then(coqInit)`. The duplicate `LoadPkg` + `Init` collide,
 * and the worker ends up without `Coq.Init` bound in its lib_path — so the
 * very next sentence fails with the anomaly "Cannot find a physical path
 * bound to logical path Coq.Init.Prelude".
 *
 * Fix: while reset is running, neuter `Manager.coqBoot` so it only does
 * `interruptSetup` and skips the `loadDeps + coqInit` half. The reset()
 * method itself drives the (correct) reload sequence.
 */
function patchResetRace(coq: CoqMgr) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mgr = coq as any;
  const origCoqBoot: () => Promise<void> | void = mgr.coqBoot.bind(mgr);
  const origReset: () => Promise<unknown> = mgr.reset.bind(mgr);
  let resetting = false;
  mgr.coqBoot = function () {
    if (resetting) {
      // The re-spawned worker still needs interrupts wired up.
      this.coq.interruptSetup();
      return;
    }
    return origCoqBoot();
  };
  mgr.reset = async function () {
    resetting = true;
    try {
      return await origReset();
    } finally {
      resetting = false;
    }
  };
}

declare global {
  interface Window {
    JsCoq?: { start: (opts: JsCoqOpts) => Promise<CoqMgr> };
  }
}

/** Inject a stylesheet once; return cleanup that removes it. */
function injectStylesheet(href: string): () => void {
  const existing = document.querySelector<HTMLLinkElement>(`link[data-jscoq-href="${href}"]`);
  if (existing) {
    existing.dataset.refcount = String((Number(existing.dataset.refcount) || 1) + 1);
    return () => {
      const n = (Number(existing.dataset.refcount) || 1) - 1;
      if (n <= 0) existing.remove();
      else existing.dataset.refcount = String(n);
    };
  }
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.dataset.jscoqHref = href;
  link.dataset.refcount = '1';
  document.head.appendChild(link);
  return () => {
    const n = (Number(link.dataset.refcount) || 1) - 1;
    if (n <= 0) link.remove();
    else link.dataset.refcount = String(n);
  };
}

/** Dynamically import jsCoq's ES-module entry. We use a literal import()
 *  with a constructed URL so vite doesn't try to transform the path —
 *  the file lives in /public/, not in src/. */
async function loadJsCoq(basePath: string): Promise<NonNullable<Window['JsCoq']>> {
  if (window.JsCoq) return window.JsCoq;
  // /* @vite-ignore */ tells vite "leave this dynamic import alone"
  const url = `${basePath}jscoq.js`;
  const mod = (await import(/* @vite-ignore */ url)) as { JsCoq?: NonNullable<Window['JsCoq']> };
  if (!mod.JsCoq) throw new Error('jscoq.js loaded but JsCoq export missing');
  // jsCoq stashes itself on window for legacy addons.
  window.JsCoq = mod.JsCoq;
  return mod.JsCoq;
}

interface Props {
  /** Initial code to load into the editor. */
  initialCode?: string;
  /** Filename shown in the file-tab area. */
  filename?: string;
  /** Logical-name → list of jsCoq packages to make available. We pass
   *  through to jsCoq's `init_pkgs` (loaded eagerly) and `all_pkgs`
   *  (resolved on `Require`). */
  initPkgs?: string[];
  allPkgs?: string[];
  /** Light or dark panel theme. */
  theme?: 'light' | 'dark';
  /** Fired once `JsCoq.start` resolves; receives the CoqManager so the
   *  parent can hook progress / AI events later. */
  onReady?: (coq: CoqMgr) => void;
}

export default function JsCoqIDE({
  initialCode,
  filename = 'scratchpad.v',
  initPkgs = ['init'],
  // jsCoq's `all_pkgs` lists *bundle* files (each bundle's `<name>.json`
  // describes its chunks). The chunks like `coq-base`, `sf-LF` are listed
  // INSIDE these bundles, NOT fetched directly. coq-pkgs/ ships:
  //   - coq.json                 (chunks: init, coq-base, coq-arith, …)
  //   - software-foundations.json (chunks: sf-LF, sf-PLF, sf-VFA, sf-SLF)
  // Passing chunk names (e.g. 'coq-base') as bundles 404s on `<name>.json`.
  allPkgs = ['coq', 'software-foundations'],
  theme = 'light',
  onReady,
}: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const coqRef = useRef<CoqMgr | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    // jsCoq's PackageManager constructs `new URL('coq-pkgs', base_path)`
    // which requires `base_path` to be an *absolute* URL — a leading
    // `/jscoq/` blows up with "Invalid base URL". Build the full origin
    // URL so jsCoq's internals work consistently.
    const basePath = `${window.location.origin}/jscoq/`;

    // 1. Inject jsCoq's stylesheet (Bootstrap + classic IDE styles).
    const removeCss = injectStylesheet(`${basePath}dist/frontend/index.css`);

    // 2. Load + start jsCoq once the wrapper div is in the DOM.
    let cleanup: (() => void) | undefined;
    (async () => {
      try {
        const JsCoq = await loadJsCoq(basePath);
        if (cancelledRef.current) return;

        const coq = await JsCoq.start({
          backend: 'wa',
          base_path: basePath,
          implicit_libs: true,
          file_dialog: false,
          init_pkgs: initPkgs,
          all_pkgs: allPkgs,
          editor: { mode: { 'company-coq': true }, theme: theme === 'dark' ? 'blackboard' : 'default' },
          theme,
        });
        if (cancelledRef.current) return;
        coqRef.current = coq;
        patchResetRace(coq);

        // Initial code load — `coq.provider.snippets[0]` is the editor's
        // CodeMirror buffer. setValue replaces the contents.
        if (initialCode !== undefined) {
          const sn = coq.provider.snippets[0];
          sn?.setValue?.(initialCode);
          if (sn) sn.filename = filename;
        }

        onReady?.(coq);
      } catch (e) {
        console.error('[JsCoqIDE] start failed:', e);
      }
    })();

    return () => {
      cancelledRef.current = true;
      cleanup?.();
      removeCss();
      // jsCoq doesn't expose a teardown — we just clear the wrapper. The
      // worker process leaks until the page unloads, which is the same
      // behavior as scratchpad.html.
      const w = wrapperRef.current;
      if (w) w.innerHTML = '';
      coqRef.current = null;
    };
    // initPkgs/allPkgs identity matters here; restart is heavyweight so
    // we deliberately don't include initialCode in deps (use props.key
    // from the parent if a remount is required).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  return (
    // jscoq's CSS is rooted at body.jscoq-main and #ide-wrapper. We add
    // .jscoq-main on a wrapping div instead of <body> so it doesn't bleed
    // into the rest of our app.
    <div className="jscoq-main jscoq-host" style={{ position: 'relative', height: '100%', width: '100%' }}>
      <div
        ref={wrapperRef}
        id="ide-wrapper"
        className="toggled"
        data-filename={filename}
        style={{ height: '100%', width: '100%' }}
      />
    </div>
  );
}
