/**
 * Chapter page: 2-pane layout.
 *
 *   [ ChapterTOC | iframe SF book + jsCoq IDE ]
 *
 * The iframe loads our same-origin proxy of coq.vercel.app's SF book +
 * jsCoq IDE (see server/routers/sf_proxy.py for the proxy details).
 * Same-origin means the parent React app can read the iframe's
 * CodeMirror instances directly, so the per-exercise Submit button
 * doesn't need a clipboard hop — it just walks the iframe DOM,
 * collects each editor's value, and POSTs them to the splice/grade
 * endpoint.
 *
 * URL: `/volume/:volumeId/chapter/:chapterName` (unchanged).
 */

import { useParams, useNavigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import ChapterTOC from '../components/ChapterTOC';
import ChapterProgressBar from '../components/ChapterProgressBar';
import TutorPanel from '../components/TutorPanel';
import { useChapterProgress, useChapterBlocks } from '../coq/exerciseGrading';
import { writeChapterBlocks } from '../coq/iframeReader';
import { getSavedChapterBlocks } from '../api/client';

export default function ChapterPage() {
  const { volumeId, chapterName } = useParams<{ volumeId: string; chapterName: string }>();
  const navigate = useNavigate();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  // Bumped on each successful grade so listeners (leaderboard widget, etc.)
  // can re-fetch via prop changes.
  const [, setGradeVersion] = useState(0);

  // Strip any `.v` suffix the URL might carry; SF pages are <Chapter>.html.
  const chapter = (chapterName ?? '').replace(/\.v$/, '');

  // Per-user per-chapter progress. Drives the sticky progress bar and
  // the TOC checkmarks. `refresh()` is called from inside ChapterTOC
  // after each successful Grade.
  const { progress, refresh: refreshProgress } = useChapterProgress(volumeId ?? '', chapter);

  // Persisted per-block edits (from previous Submit clicks). Restored
  // into the iframe's CodeMirror instances once wacoq has finished
  // creating them.
  const { read: readSavedBlocks, write: writeSavedBlocks } = useChapterBlocks(volumeId ?? '', chapter);

  // After the iframe (re)mounts, poll until wacoq has spun up its
  // CodeMirrors, then push previously-saved blocks back into them.
  // Source priority:
  //   1. localStorage `sf:blocks:<vol>:<slug>` — written on every Submit.
  //   2. Server's saved chapter .v (extracted via /coq/file/.../blocks)
  //      — covers the case where the user is on a fresh browser /
  //      cleared site data but has solutions in the DB from earlier.
  useEffect(() => {
    if (!volumeId || !chapterName) return;
    let cancelled = false;

    const restore = async () => {
      let blocks = readSavedBlocks();
      if (!blocks || blocks.length === 0) {
        try {
          const resp = await getSavedChapterBlocks(volumeId, chapter);
          if (resp.blocks && resp.blocks.length > 0) {
            blocks = resp.blocks;
            // Mirror to localStorage so subsequent reloads use the
            // fast-path without a server round-trip.
            writeSavedBlocks(blocks);
          }
        } catch { /* no saved file or auth/network issue — that's fine */ }
      }
      if (!blocks || blocks.length === 0 || cancelled) return;

      // Wait for wacoq to finish creating its CodeMirrors. Poll until
      // the count stabilises across two ticks before writing.
      let lastCount = -1;
      let stableTicks = 0;
      const tick = () => {
        if (cancelled) return;
        const iframe = iframeRef.current;
        const doc = iframe?.contentDocument;
        const count = doc?.querySelectorAll('.CodeMirror').length ?? 0;
        if (count > 0 && count === lastCount) {
          stableTicks++;
          if (stableTicks >= 2) {
            writeChapterBlocks(iframe, blocks!);
            return;
          }
        } else {
          stableTicks = 0;
        }
        lastCount = count;
        setTimeout(tick, 500);
      };
      setTimeout(tick, 800);
    };

    void restore();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [volumeId, chapter]);

  // With cross-origin iframe to coq.vercel.app, we can't read the
  // iframe's location to detect internal navigations. Users navigate
  // between chapters via our sidebar instead.
  void navigate;

  if (!volumeId || !chapterName) {
    return <div style={{ padding: 24 }}>Missing chapter parameters.</div>;
  }

  // Same-origin proxy to coq.vercel.app/ext/sf/<vol>/full/<chapter>.html.
  // The server inserts a <base href> so relative asset URLs still load
  // from upstream, and proxies the absolute /wa/... wacoq runtime paths.
  // Result: same DOM as upstream, but at our origin — React can read
  // iframe.contentDocument and walk the CodeMirror instances directly.
  const src = `/sfproxy/chapter/${volumeId}/${chapter}.html`;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-white">
      <ChapterTOC
        volumeId={volumeId}
        currentSlug={chapter}
        iframeRef={iframeRef}
        serverProgress={progress}
        refreshProgress={refreshProgress}
        onGraded={() => { setGradeVersion(v => v + 1); refreshProgress(); }}
      />
      <div className="flex-1 flex flex-col min-w-0 bg-white">
        <ChapterProgressBar
          progress={progress}
          volumeId={volumeId}
          chapterSlug={chapter}
          iframeRef={iframeRef}
          onGraded={() => { setGradeVersion(v => v + 1); refreshProgress(); }}
        />
        <iframe
          ref={iframeRef}
          // `key={src}` forces a fresh iframe on chapter change.
          key={src}
          title={`${volumeId} / ${chapter}`}
          src={src}
          className="flex-1 border-0 bg-white"
          // `credentialless` matches the parent's COEP so SharedArrayBuffer
          // (required by wacoq) keeps working in the iframe.
          // @ts-expect-error not in React's IframeHTMLAttributes yet
          credentialless="true"
        />
      </div>
      <TutorPanel volumeId={volumeId} chapterSlug={chapter} iframeRef={iframeRef} />
    </div>
  );
}
