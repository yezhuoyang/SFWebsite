/**
 * Chapter page: 2-pane layout.
 *
 *   [ ChapterTOC | iframe SF book + jsCoq IDE ]
 *
 * The TOC is a React component that lists the volume's chapters and
 * navigates between them. The iframe loads coq.vercel.app's working SF
 * book + jsCoq IDE — we don't touch its DOM (cross-origin) so the
 * font / rendering / Coq behavior stay exactly as on the upstream site.
 *
 * URL: `/volume/:volumeId/chapter/:chapterName` (unchanged).
 *
 * Phase 1 plan: replace the cross-origin iframe with a same-origin
 * page hosting wacoq locally. That'll let us read the proof state and
 * student code from the iframe via postMessage / direct property access,
 * which is what's needed to drive grading and AI feedback.
 *
 * The legacy block-based ChapterPage (Monaco, per-exercise grading,
 * tutor, annotations) is preserved at ChapterPage.legacy.tsx for
 * reference while we re-graft those features.
 */

import { useParams, useNavigate } from 'react-router-dom';
import { useRef, useState } from 'react';
import ChapterTOC from '../components/ChapterTOC';
import ChapterProgressBar from '../components/ChapterProgressBar';
import TutorPanel from '../components/TutorPanel';
import { useChapterProgress } from '../coq/exerciseGrading';

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

  // With cross-origin iframe to coq.vercel.app, we can't read the
  // iframe's location to detect internal navigations. Users navigate
  // between chapters via our sidebar instead.
  void navigate;

  if (!volumeId || !chapterName) {
    return <div style={{ padding: 24 }}>Missing chapter parameters.</div>;
  }

  // Direct cross-origin iframe to upstream. We tried a same-origin
  // proxy in `vite.config.ts` to enable React → iframe state reads
  // (for grading / tutor), but wacoq's COOP+COEP + SharedArrayBuffer
  // constraints made that brittle. Letting the upstream serve the
  // whole IDE as a self-consistent unit is reliable.
  //
  // Consequence: React can't read `iframe.contentWindow.coq`. The
  // GradePanel / TutorPanel will need a paste-textarea fallback so
  // students can submit their code separately.
  const src = `https://coq.vercel.app/ext/sf/${volumeId}/full/${chapter}.html`;

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
          onGraded={() => { setGradeVersion(v => v + 1); refreshProgress(); }}
        />
        <iframe
          ref={iframeRef}
          // `key={src}` forces a fresh iframe on chapter change. The
          // cross-origin iframe gives us no API to imperatively navigate
          // it without a reload anyway, so a remount is fine.
          key={src}
          title={`${volumeId} / ${chapter}`}
          src={src}
          className="flex-1 border-0 bg-white"
          // `credentialless` lets a COEP=require-corp parent embed a
          // cross-origin iframe without the iframe's host having to send
          // CORP. Chrome 110+.
          // @ts-expect-error not in React's IframeHTMLAttributes yet
          credentialless="true"
        />
      </div>
      <TutorPanel volumeId={volumeId} chapterSlug={chapter} iframeRef={iframeRef} />
    </div>
  );
}
