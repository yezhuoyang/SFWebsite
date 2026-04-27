/**
 * Stages SF book HTML files for the in-page jsCoq IDE.
 *
 * Source: ../<vol>/*.html plus a shared common/ asset tree (CSS, jquery-ui,
 * media, toggleproofs.js, jscoq.js, jscoq.css). All four volumes ship
 * identical common/ trees, so we copy one shared copy into
 * public/sf/common/ and rewrite each page's `common/...` URLs to
 * `../common/...`.
 *
 * Output layout:
 *   public/sf/common/...           (shared CSS, jquery-ui, etc.)
 *   public/sf/common/jscoq.js      (REPLACED with our patched embed)
 *   public/sf/common/css/jscoq.css (kept from source)
 *   public/sf/<vol>/<chapter>.html (SF page with jsCoq link/script appended)
 *
 * The patched jscoq.js mirrors coq.vercel.app's lf/common/jscoq.js: same
 * #jscoq-plug button, deprettify substitutions, terse-mode detection,
 * close button. The only differences:
 *   - imports JsCoq as an ES module from /jscoq/jscoq.js (no global)
 *   - uses backend: 'wa' (WASM)
 *   - base_path: ${origin}/jscoq/
 *   - all_pkgs: ['coq', 'software-foundations'] (no @jscoq affiliate alias)
 *
 * Re-run with `npm run sf:stage`.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CLIENT = path.resolve(__dirname, '..');
const DEST = path.join(CLIENT, 'public', 'sf');

const VOLUMES = ['lf', 'plf', 'vfa', 'slf'];

async function rmrf(p) {
  await fs.rm(p, { recursive: true, force: true });
}

/**
 * Copy a directory tree, overwriting existing files. We deliberately do
 * NOT rmrf the destination first: Vite's dev-server static handler caches
 * its view of `public/` at startup, and wholesale-deleting subtrees
 * makes deeper subdirectory paths un-servable until restart. Adding /
 * overwriting files in place is safe.
 */
async function copyDir(src, dst) {
  await fs.mkdir(dst, { recursive: true });
  for (const ent of await fs.readdir(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dst, ent.name);
    if (ent.isDirectory()) await copyDir(s, d);
    else if (ent.isFile()) await fs.copyFile(s, d);
  }
}

// SF book navigation pages — no Coq code, so don't inject jsCoq.
const SF_NAV_FILES = new Set(['toc.html', 'index.html', 'coqindex.html', 'deps.html']);

const VOLUME_TITLES = {
  lf:  'Volume 1: Logical Foundations',
  plf: 'Volume 2: Programming Language Foundations',
  vfa: 'Volume 3: Verified Functional Algorithms',
  slf: 'Volume 4: Separation Logic Foundations',
};

/**
 * Wraps a freshly coqdoc-generated chapter HTML with the SF book chrome
 * (sf.css + volume.css + jquery-ui + logo/title/menu header). coqdoc
 * emits a barebones page with only `<link href="coqdoc.css">` and an
 * empty `<div id="header">`; the SF Makefile normally post-processes
 * those into the full chrome shown on softwarefoundations.cis.upenn.edu,
 * but we don't have that pipeline locally, so we apply the same patches
 * here at staging time.
 */
function injectSfChrome(html, vol) {
  // Already has SF chrome (e.g. toc.html restored from git, or any
  // chapter that wasn't regenerated). Leave it alone.
  if (html.includes('common/css/sf.css')) return html;

  const title = VOLUME_TITLES[vol] || vol.toUpperCase();
  const headLinks =
    '<link href="../common/css/sf.css" rel="stylesheet" type="text/css" />\n' +
    '<link href="../common/jquery-ui/jquery-ui.css" rel="stylesheet">\n' +
    '<script src="../common/jquery-ui/external/jquery/jquery.js"></script>\n' +
    '<script src="../common/jquery-ui/jquery-ui.js"></script>\n' +
    '<script src="../common/toggleproofs.js"></script>\n' +
    `<link href="../common/css/${vol}.css" rel="stylesheet" type="text/css"/>`;
  const headerHtml =
    '<div id="header">\n' +
    "<div id='logoinheader'><a href='https://softwarefoundations.cis.upenn.edu'>\n" +
    "<img src='../common/media/image/sf_logo_sm.png' alt='Software Foundations Logo'></a></div>\n" +
    `<div class='booktitleinheader'><a href='index.html'>${title}</a></div>\n` +
    "<ul id='menu'>\n" +
    "   <li class='section_name'><a href='toc.html'>Table of Contents</a></li>\n" +
    "   <li class='section_name'><a href='coqindex.html'>Index</a></li>\n" +
    "   <li class='section_name'><a href='deps.html'>Roadmap</a></li>\n" +
    '</ul>\n' +
    '</div>';

  let out = html;
  // Replace coqdoc's lone stylesheet link with the SF chrome bundle.
  out = out.replace(
    /<link[^>]*href=["']coqdoc\.css["'][^>]*\/?>/,
    headLinks,
  );
  // Replace coqdoc's empty header div with the full SF header.
  out = out.replace(
    /<div id="header">\s*<\/div>/,
    headerHtml,
  );
  return out;
}

/**
 * Patches the SF page HTML:
 *  - inject SF book chrome (header, stylesheets) for regenerated chapters
 *  - rewrite `common/X` -> `../common/X` (so all volumes share one common/)
 *  - inject `<link>` to the SF/jsCoq glue stylesheet (jscoq.css) into <head>
 *  - inject our patched jscoq.js as a module before `</body>` (only for
 *    pages that contain Coq code; nav pages like toc.html are skipped)
 */
function injectJsCoq(html, vol, file) {
  let out = html;
  // 0. SF chrome for freshly coqdoc-generated chapter HTMLs.
  out = injectSfChrome(out, vol);
  // 1. relative path rewrite
  out = out.replace(/(href|src)=("|')common\//g, '$1=$2../common/');
  // 1b. Coq 8.18+ renamed the stdlib's logical-path prefix from `Coq` to
  // `Stdlib`. The current SF sources use `From Stdlib Require Import …`,
  // but our bundled wacoq is Coq 8.17 where the prefix is still `Coq`.
  // Rewrite the token in the rendered code blocks so the editor's text
  // matches what the worker can resolve. We target only span-wrapped
  // occurrences (i.e. tokens in code), not prose mentions of "Stdlib".
  // Mirrors `sed 's/^From Stdlib /From Coq /g'` in rebuild_sf_pkg.sh.
  out = out.replace(/>Stdlib</g, '>Coq<');
  // 1c. Same fix for the `%_X` notation deprecation (8.18+ requires `%X`).
  out = out.replace(/%_([A-Za-z])/g, '%$1');
  // For nav pages (toc/index/coqindex/deps), stop here — no jsCoq IDE.
  if (SF_NAV_FILES.has(file)) {
    // Still drop the volume background image so the page reads cleanly.
    out = out.replace(
      '</head>',
      '<style>body { background-image: none !important; background-color: white !important; }</style>\n</head>',
    );
    return out;
  }
  // 2. add CSS links inside <head>:
  //    - the jsCoq IDE classic stylesheet (panel layout, button styles, etc.)
  //    - the SF/jsCoq glue stylesheet (#jscoq-plug button, panel max-width)
  //    - inline overrides: drop the per-volume body background image (the
  //      gradient `lf.css`/`plf.css`/etc. set on `body`), which would
  //      otherwise show in the empty space left of `#main` once the
  //      jsCoq panel takes the right of the viewport.
  const cssLinks = [
    '<link href="/jscoq/dist/frontend/index.css" rel="stylesheet" type="text/css" />',
    '<link href="../common/css/jscoq.css" rel="stylesheet" type="text/css" />',
    '<style>body { background-image: none !important; background-color: white !important; }</style>',
  ].join('\n');
  out = out.replace('</head>', `${cssLinks}\n</head>`);
  // 3. add our embed module before </body>
  const embed = '<script type="module" src="../common/jscoq.js"></script>\n</body>';
  out = out.replace('</body>', embed);
  return out;
}

async function stageVolume(vol) {
  const src = path.join(REPO_ROOT, vol);
  const dst = path.join(DEST, vol);
  await fs.mkdir(dst, { recursive: true });

  let count = 0;
  for (const f of await fs.readdir(src)) {
    if (!f.endsWith('.html')) continue;
    const html = await fs.readFile(path.join(src, f), 'utf8');
    await fs.writeFile(path.join(dst, f), injectJsCoq(html, vol, f));
    count++;
  }
  console.log(`  ${vol}: ${count} pages`);
}

async function stageCommon() {
  // Single shared copy. lf/plf/vfa/slf all ship identical trees.
  const src = path.join(REPO_ROOT, 'lf', 'common');
  const dst = path.join(DEST, 'common');
  await copyDir(src, dst);
  console.log(`  common/: shared from lf/common`);
}

/**
 * Patched version of lf/common/jscoq.js. Same SF-specific behaviors as
 * coq.vercel.app, but loads JsCoq as an ES module (so we don't need the
 * jscoq.js global setup) and points at our /jscoq/ asset tree.
 */
function patchedEmbed() {
  return `/**
 * SF book + jsCoq IDE embed.
 * Patched from lf/common/jscoq.js — see scripts/stage-sf.mjs.
 *
 * Loaded as a deferred ES module from each chapter HTML, after jQuery
 * and toggleproofs.js have run. Imports JsCoq directly (no global
 * load() dance) and points at /jscoq/ for assets.
 */

import { JsCoq, Deprettify } from '/jscoq/jscoq.js';
window.JsCoq = JsCoq;

// jsCoq's PackageManager builds \`new URL('coq-pkgs', base_path)\`, which
// throws if base_path isn't absolute. So we anchor on the page origin.
const BASE_PATH = \`\${window.location.origin}/jscoq/\`;

// We use the JS backend (jsCoq classic) instead of wacoq. The JS backend
// implements jsCoq's \`Pending\` lazy-load mechanism: when a sentence does
// \`From LF Require Import Maps.\`, the worker tells the manager which
// modules it needs and the manager downloads the matching chunks
// on-demand. wacoq doesn't relay \`Pending\`, so cross-volume Require
// fails with "Cannot find a physical path" unless we pre-load every
// chunk — which itself hangs the wacoq worker for reasons that remain
// opaque. coq.vercel.app uses the JS backend for the same reason.

// Phase 0: always show the IDE (no toggle UX yet). Once we wire up the
// React shell's progress / AI panes, we can revisit the toggle logic.
const jsCoqShow = location.search !== '?jscoq=off';

const jscoq_ids = [
  '#main > div.code, #main > div.HIDEFROMHTML > div.code, #main div.proofscript > div.code'
];

const jscoq_opts = {
  backend: 'js',
  base_path: BASE_PATH,
  // Use 'fixed' layout (panel position:fixed top-right, body
  // padding-right) instead of 'flex' (body display:flex). 'flex' makes
  // every direct body child a side-by-side column, which breaks
  // coqdoc-generated index pages (toc.html / coqindex.html / deps.html)
  // where \`#main\` is a sibling of \`#page\` rather than a child.
  layout: 'fixed',
  show: jsCoqShow,
  focus: false,
  replace: true,
  editor: { mode: { 'company-coq': true }, className: 'jscoq code-tight' },
  init_pkgs: ['init'],
  // 'software-foundations' is in jsCoq's PKG_AFFILIATES list, which makes
  // a flat array entry resolve to \`\${node_modules_path}@jscoq/software-foundations/coq-pkgs\`
  // — that path 404s in our setup, so \`software-foundations.json\` never
  // loads and \`loadDeps(['sf-LF'])\` blocks in \`waitFor\` forever. Use an
  // absolute URL as the all_pkgs key (per jsCoq's own SF embed) to bypass
  // the affiliate alias and point at our actual /jscoq/coq-pkgs/.
  all_pkgs: {
    '+': ['coq'],
    [BASE_PATH + 'coq-pkgs']: ['software-foundations'],
  },
  init_import: ['utf8'],
  implicit_libs: true,
};

function isTerse() {
  return document.querySelectorAll('[src$="/slides.js"]').length > 0;
}

/**
 * Allow foldable code snippets to still be foldable. Only works when the
 * entire snippet is in (* FOLD *) ... (* /FOLD *).
 */
function spoilerAlert($el) {
  const tog = $el.children('.togglescript:first-child');
  const spoiler = tog.next('.proofscript');
  if (tog.length > 0 && spoiler.length > 0) {
    $el.removeClass('code');
    spoiler.attr('onclick', '')
      .append($('<div>').addClass('code').append(spoiler[0].childNodes));
  }
}

function jsCoqInject() {
  $(document.body).attr('id', 'ide-wrapper').addClass('toggled')
    .addClass(isTerse() ? 'terse' : 'full')
    .append($('<div id="jscoq-plug">').on('click', () => window.coq?.layout.show()));
}

async function jsCoqLoad() {
  // Drop empty code fragments (coqdoc emits some); keep folded snippets.
  $('#main > div.code').each(function () {
    if ($(this).text().match(/^\\s*$/)) $(this).remove();
    else spoilerAlert($(this));
  });

  // Make page focusable so keyboard scroll works.
  const page = document.querySelector('#page');
  if (page) {
    page.setAttribute('tabindex', '-1');
    page.focus();
  }

  // Pretty-print substitutions used across SF books.
  Deprettify.REPLACES.push(
    [/∨/g, '\\\\/'],
    [/∧/g, '/\\\\'],
    [/↔/g, '<->'],
    [/≤/g, '<='],
    [/≥/g, '>='],
    [/≠/g, '<>'],
    [/∈/g, '\\\\in'],
    [/\\u2212∗/g, '\\\\-*'],
    [/\\u2212−∗/g, '\\\\--*'],
    [/\\\\u2200/g, '\\\\forall'],
  );

  const coq = await JsCoq.start(jscoq_ids, jscoq_opts);
  window.coq = coq;

  // If for some reason the panel didn't auto-show, force it now.
  if (jsCoqShow && !coq.layout.isVisible()) coq.layout.show();

  // Pre-loader: jsCoq's automatic \`Pending\` lazy-load doesn't fire
  // reliably for cross-volume \`From LF/PLF/VFA/SLF Require\` statements,
  // so the worker errors with "Cannot find a physical path bound to
  // logical path X with prefix Y". Hook \`manager.add\` to detect a
  // prefix match in the sentence text and load the matching SF chunk
  // (and its prereqs) before forwarding the Add to the worker.
  const SF_PREFIX_CHUNKS = {
    LF:  ['sf-LF'],
    PLF: ['sf-LF', 'sf-PLF'],
    VFA: ['sf-LF', 'sf-VFA'],
    SLF: ['sf-LF', 'sf-PLF', 'sf-SLF'],
  };
  const origAdd = coq.add.bind(coq);
  coq.add = async function (stm, tip) {
    if (stm && stm.text && !stm.flags.is_comment) {
      const m = stm.text.match(/From\\s+(LF|PLF|VFA|SLF)\\s+Require/);
      if (m) {
        const wanted = SF_PREFIX_CHUNKS[m[1]];
        const have = new Set(coq.packages.loaded_pkgs);
        const toLoad = wanted.filter(c => !have.has(c));
        if (toLoad.length) {
          coq.disable();
          coq.packages.expand();
          try {
            await coq.packages.loadDeps(toLoad);
            coq.coq.refreshLoadPath(coq.getLoadPath());
          } finally {
            coq.packages.collapse();
            coq.enable();
          }
        }
      }
    }
    return origAdd(stm, tip);
  };
}

if (location.search !== '?jscoq=no') {
  // Module scripts run after DOMContentLoaded, so we can call directly.
  jsCoqInject();
  jsCoqLoad();
}
`;
}

async function writeEmbedScript() {
  const dst = path.join(DEST, 'common', 'jscoq.js');
  await fs.writeFile(dst, patchedEmbed());
  console.log(`  common/jscoq.js: patched`);
}

async function main() {
  console.log('Staging SF book pages -> public/sf/');
  await fs.mkdir(DEST, { recursive: true });
  await stageCommon();
  for (const vol of VOLUMES) await stageVolume(vol);
  await writeEmbedScript();
  console.log('Done.');
}

main().catch(e => { console.error(e); process.exit(1); });
