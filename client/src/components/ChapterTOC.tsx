/**
 * In-chapter TOC sidebar: shows the section / subsection / exercise
 * headings inside the *current* chapter. Click an entry to scroll the
 * iframe to that section.
 *
 * The headings are read from the iframe DOM (same-origin proxy)
 * once the chapter HTML has loaded. Each `<h1|h2|h3|h4 class="section">`
 * inside the SF book is preceded by an anchor `<a id="labNN">` —
 * scrolling = `iframe.contentDocument.getElementById(anchor).scrollIntoView()`.
 *
 * Top of the sidebar still has Prev/Next chapter navigation for
 * sequential reading. Bottom has the GradePanel.
 */

import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { SF_CHAPTERS, getChapter, type ChapterEntry } from '../data/sfChapters';
import { STATIC_VOLUMES } from '../data/sfVolumes';
import ChapterCodeBuffer from './ChapterCodeBuffer';
import ExerciseGradeButton from './ExerciseGradeButton';
import {
  useChapterCodeBuffer,
  useExerciseGrades,
  parseExerciseName,
} from '../coq/exerciseGrading';
import type { ExerciseGrade } from '../api/client';

interface Props {
  volumeId: string;
  currentSlug: string;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  onGraded?: () => void;
}

interface TocEntry {
  level: number;       // 1=section, 2=subsection, 3=subsubsection, 4=exercise
  text: string;        // visible heading text
  anchor: string;      // <a id="labNN"> id to scroll to
  isExercise: boolean; // h4.section containing "Exercise:"
}

const VOLUME_COLORS: Record<string, string> = {
  lf: 'bg-blue-500',
  plf: 'bg-violet-500',
  vfa: 'bg-emerald-500',
  slf: 'bg-amber-500',
};

/** Parse the chapter's section headings out of an HTML string. */
function extractToc(html: string): TocEntry[] {
  // Use the browser's parser instead of regex — the SF HTML is not
  // shaped friendly for regex (lots of nested span markup).
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const entries: TocEntry[] = [];
  const anchors = doc.querySelectorAll<HTMLAnchorElement>('#main a[id^="lab"]');
  anchors.forEach(a => {
    const h = a.nextElementSibling as HTMLElement | null;
    if (!h) return;
    const tag = h.tagName.toLowerCase();
    const level = tag === 'h1' ? 1 : tag === 'h2' ? 2 : tag === 'h3' ? 3 : tag === 'h4' ? 4 : 0;
    if (!level || !h.classList.contains('section')) return;
    const text = (h.textContent || '').trim();
    if (!text) return;
    entries.push({
      level,
      text,
      anchor: a.id,
      isExercise: level === 4 && text.startsWith('Exercise:'),
    });
  });
  return entries;
}

/** Fetch the chapter HTML from coq.vercel.app and extract its TOC.
 *  CORS is open (`Access-Control-Allow-Origin: *`), so the GET works
 *  from our origin. Re-fetches when (volume, slug) changes. */
function useChapterToc(volumeId: string, slug: string): TocEntry[] {
  const [toc, setToc] = useState<TocEntry[]>([]);
  useEffect(() => {
    let cancelled = false;
    setToc([]);
    const url = `https://coq.vercel.app/ext/sf/${volumeId}/full/${slug}.html`;
    fetch(url)
      .then(r => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(html => { if (!cancelled) setToc(extractToc(html)); })
      .catch(() => { if (!cancelled) setToc([]); });
    return () => { cancelled = true; };
  }, [volumeId, slug]);
  return toc;
}

/** Cross-origin iframes don't expose contentDocument, so we navigate
 *  the iframe to the same chapter URL with the anchor fragment — the
 *  browser scrolls to that anchor on load. Triggers a reload, which is
 *  unfortunate but unavoidable cross-origin. */
function jumpTo(iframeRef: React.RefObject<HTMLIFrameElement | null>, volumeId: string, slug: string, anchor: string) {
  const iframe = iframeRef.current;
  if (!iframe) return;
  iframe.src = `https://coq.vercel.app/ext/sf/${volumeId}/full/${slug}.html#${anchor}`;
}

export default function ChapterTOC({ volumeId, currentSlug, iframeRef, onGraded }: Props) {
  const navigate = useNavigate();
  const chapters = SF_CHAPTERS[volumeId] ?? [];
  const idx = chapters.findIndex(c => c.slug === currentSlug);
  const current: ChapterEntry | undefined = idx >= 0 ? chapters[idx] : getChapter(volumeId, currentSlug);
  const prev = idx > 0 ? chapters[idx - 1] : null;
  const next = idx >= 0 && idx < chapters.length - 1 ? chapters[idx + 1] : null;
  const volume = STATIC_VOLUMES.find(v => v.id === volumeId);
  const dot = VOLUME_COLORS[volumeId] ?? 'bg-gray-400';
  // Volume nav pages (toc / index / coqindex / deps) have no in-chapter
  // outline. The Submit & Grade button is hidden there too — there's no
  // student code to grade on those pages.
  const isVolumeNav = currentSlug === 'toc' || currentSlug === 'index' || currentSlug === 'coqindex' || currentSlug === 'deps';

  const toc = useChapterToc(volumeId, currentSlug);
  const { code, setCode } = useChapterCodeBuffer(volumeId, currentSlug);
  const { grades, recordGrade } = useExerciseGrades(volumeId, currentSlug);
  const [needCodeTick, setNeedCodeTick] = useState(0);

  const ingestGrades = (received: ExerciseGrade[]) => {
    received.forEach(recordGrade);
  };

  return (
    <aside className="w-72 shrink-0 bg-white border-r border-gray-200/80 flex flex-col h-full overflow-hidden">
      {/* Header — volume + chapter title + prev/next */}
      <div className="p-3 border-b border-gray-100">
        <div className="flex items-center gap-2 text-[11px]">
          <span className={`w-2 h-2 rounded-full ${dot}`} />
          <Link to="/" className="text-gray-400 hover:text-gray-600 uppercase tracking-wide font-semibold">
            ← {volume?.namespace ?? volumeId.toUpperCase()}
          </Link>
        </div>
        {/* Chapter selector. Cross-origin iframe means we can't see
            iframe-internal navigation, so the user picks the chapter
            here to keep the sidebar in sync. Whatever's selected drives
            the in-chapter TOC below. */}
        <select
          value={currentSlug}
          onChange={e => navigate(`/volume/${volumeId}/chapter/${e.target.value}`)}
          className="mt-2 w-full text-sm font-bold text-gray-800 bg-transparent border border-gray-200 rounded-md px-2 py-1.5 hover:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
          aria-label="Switch chapter"
          title={current?.title ?? volume?.name}
        >
          {!chapters.some(c => c.slug === currentSlug) && (
            <option value={currentSlug}>{currentSlug}</option>
          )}
          {chapters.map(ch => (
            <option key={ch.slug} value={ch.slug}>{ch.title}</option>
          ))}
        </select>
        {!isVolumeNav && (
          <div className="flex gap-1 mt-2 text-[11px]">
            {prev ? (
              <Link
                to={`/volume/${volumeId}/chapter/${prev.slug}`}
                className="flex-1 px-2 py-1 rounded-md border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 text-gray-500 hover:text-indigo-700 truncate transition-colors"
                title={prev.title}
              >
                ← {prev.slug}
              </Link>
            ) : <div className="flex-1" />}
            {next ? (
              <Link
                to={`/volume/${volumeId}/chapter/${next.slug}`}
                className="flex-1 px-2 py-1 rounded-md border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 text-gray-500 hover:text-indigo-700 truncate transition-colors text-right"
                title={next.title}
              >
                {next.slug} →
              </Link>
            ) : <div className="flex-1" />}
          </div>
        )}
      </div>

      {/* On real chapter pages: in-chapter outline (sections + exercises).
          On volume nav pages (toc / index / coqindex / deps): chapter
          list as a fallback. Volume entry now defaults to /chapter/Preface
          so users normally won't land on a nav page; this branch is
          only reached if they navigate there explicitly. */}
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {isVolumeNav ? (
          <>
            <p className="text-[11px] text-gray-400 italic px-2 mb-2">
              Pick a chapter to see its outline:
            </p>
            <ul className="space-y-0.5">
              {chapters.map((ch, i) => (
                <li key={ch.slug}>
                  <Link
                    to={`/volume/${volumeId}/chapter/${ch.slug}`}
                    className="block px-2 py-1.5 rounded text-[12px] leading-snug text-gray-700 hover:bg-gray-50 hover:text-gray-900 transition-colors"
                    title={ch.title}
                  >
                    <span className="text-[10px] text-gray-400 mr-1.5 tabular-nums">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    {ch.title}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : toc.length === 0 ? (
          <p className="text-[12px] text-gray-400 italic px-2">
            Loading chapter outline…
          </p>
        ) : (
          <ul className="space-y-0.5">
            {toc.map((entry, i) => {
              const exName = entry.isExercise ? parseExerciseName(entry.text) : null;
              const grade = exName ? grades[exName] : undefined;
              return (
                <li key={`${entry.anchor}-${i}`}>
                  <div
                    className={`flex items-center gap-1 rounded transition-colors ${
                      entry.isExercise ? 'hover:bg-emerald-50/60' : 'hover:bg-gray-50'
                    }`}
                    style={{ paddingLeft: `${0.25 + (entry.level - 1) * 0.75}rem` }}
                  >
                    <button
                      onClick={() => jumpTo(iframeRef, volumeId, currentSlug, entry.anchor)}
                      className={`flex-1 min-w-0 text-left px-1 py-1 text-[12px] leading-snug transition-colors ${
                        entry.isExercise ? 'text-emerald-700 font-medium' : 'text-gray-700'
                      }`}
                      title={entry.text}
                    >
                      <span className="block truncate">
                        {entry.isExercise && <span className="text-[9px] text-emerald-600 mr-1">●</span>}
                        {entry.text}
                      </span>
                    </button>
                    {exName && (
                      <ExerciseGradeButton
                        volumeId={volumeId}
                        chapterSlug={currentSlug}
                        exerciseName={exName}
                        code={code}
                        setCode={setCode}
                        result={grade}
                        onResult={ingestGrades}
                        onCompleted={onGraded}
                        onNeedCode={() => setNeedCodeTick(t => t + 1)}
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </nav>

      {/* "Your code" paste buffer pinned at the bottom (collapsible).
          Each Exercise → Grade button reads from this. */}
      {!isVolumeNav && (
        <ChapterCodeBuffer
          volumeId={volumeId}
          chapterSlug={currentSlug}
          flashTick={needCodeTick}
        />
      )}
    </aside>
  );
}
