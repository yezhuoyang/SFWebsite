import { useEffect, useState, useCallback, useRef } from 'react';
import Editor, { type BeforeMount, type OnMount } from '@monaco-editor/react';
import {
  getSharedSolutions,
  getMySolutions,
  getSolutionDetail,
  shareSolution,
  addSolutionComment,
  deleteSharedSolution,
  vote,
  type SharedSolutionSummary,
  type SolutionComment,
  type SolutionSort,
} from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import CoqCodeBlock from './CoqCodeBlock';
import { registerCoqLanguage, COQ_LANGUAGE_ID } from './coqLanguage';

interface Props {
  exerciseId: number;
  exerciseName: string;
  currentCode: string;
  /** Re-read the live block contents at the moment the user clicks
   *  "Use current solution". Falls back to the initial currentCode if not
   *  supplied. Lets us pull the freshest editor content without prop drilling. */
  getLatestCode?: () => string;
  onClose: () => void;
}

type Tab = 'browse' | 'mine' | 'submit';

/**
 * Parse the backend's ISO timestamp. The server emits `datetime.utcnow().isoformat()`
 * which is naive UTC (no trailing 'Z'). Without the Z, `new Date(...)` parses it as
 * *local* time, producing garbage offsets (e.g. negative "-24600s ago" for users ahead
 * of UTC). Append 'Z' if no timezone info is present so the parse is unambiguous.
 */
function parseServerDate(iso: string): Date {
  const hasTz = /Z|[+-]\d{2}:?\d{2}$/.test(iso);
  return new Date(hasTz ? iso : iso + 'Z');
}

function formatDate(iso: string): string {
  const date = parseServerDate(iso);
  const diff = Date.now() - date.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  // Older than a day: show absolute date (e.g. "4/11/2026")
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
}

export default function SolutionsModal({ exerciseId, exerciseName, currentCode, getLatestCode, onClose }: Props) {
  const { user, requireLogin } = useAuth();
  const [tab, setTab] = useState<Tab>('browse');
  const [sort, setSort] = useState<SolutionSort>('upvotes');
  const [solutions, setSolutions] = useState<SharedSolutionSummary[]>([]);
  const [mySolutions, setMySolutions] = useState<SharedSolutionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Detail view (selected solution with comments)
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedSolution, setSelectedSolution] = useState<SharedSolutionSummary | null>(null);
  const [comments, setComments] = useState<SolutionComment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [posting, setPosting] = useState(false);

  // Inline expand/collapse per list card — browsing-only, doesn't affect detail view
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const toggleExpand = (id: number) => setExpandedIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // Submit form
  const [submitCode, setSubmitCode] = useState(currentCode);
  const [submitExplanation, setSubmitExplanation] = useState('');

  // Diagnostic: confirm what we received as the prop on mount.
  // eslint-disable-next-line no-console
  console.log('[SolutionsModal] mount', { exerciseId, exerciseName, currentCodeLen: currentCode?.length, currentCodePreview: (currentCode ?? '').slice(0, 200) });

  // Monaco beforeMount: register Coq language + SF theme so <Editor> renders
  // with the same highlighting as the lecture view.
  const handleBeforeMount: BeforeMount = (monaco) => {
    registerCoqLanguage(monaco);
  };

  // Belt-and-braces: capture the Monaco editor instance and FORCIBLY set the
  // value on mount. `defaultValue`/`value` props occasionally race with the
  // lazy Monaco loader and leave the editor blank; `editor.setValue(...)`
  // after mount can't be missed.
  const editorRef = useRef<any>(null);
  const handleEditorMount: OnMount = (editor) => {
    editorRef.current = editor;
    const intended = currentCode ?? '';
    // eslint-disable-next-line no-console
    console.log('[SolutionsModal] editor onMount', {
      currentVal: editor.getValue().length,
      intendedLen: intended.length,
      willForce: editor.getValue() !== intended,
    });
    if (editor.getValue() !== intended) {
      editor.setValue(intended);
    }
  };
  const [submitting, setSubmitting] = useState(false);

  const loadBrowse = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getSharedSolutions(exerciseId, sort);
      setSolutions(data);
    } catch (err: any) {
      const msg = String(err);
      if (msg.includes('403')) {
        setError('Solve this exercise first to see other users\u2019 solutions.');
      } else {
        setError('Failed to load solutions.');
      }
    } finally {
      setLoading(false);
    }
  }, [exerciseId, sort]);

  const loadMine = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getMySolutions(exerciseId);
      setMySolutions(data);
    } catch {
      setError('Failed to load your submissions.');
    } finally {
      setLoading(false);
    }
  }, [exerciseId]);

  useEffect(() => {
    if (tab === 'browse') loadBrowse();
    else if (tab === 'mine') loadMine();
  }, [tab, loadBrowse, loadMine]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selectedId !== null) setSelectedId(null);
        else onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, selectedId]);

  const openSolution = async (id: number) => {
    setSelectedId(id);
    setSelectedSolution(null);
    setComments([]);
    try {
      const detail = await getSolutionDetail(id);
      setSelectedSolution(detail.solution);
      setComments(detail.comments);
    } catch {
      setError('Failed to load solution.');
    }
  };

  const handleVote = async (solutionId: number) => {
    try {
      const res = await vote('solution', solutionId);
      setSolutions(prev => prev.map(s =>
        s.id === solutionId ? { ...s, upvotes: res.upvotes, user_voted: res.voted } : s
      ));
      if (selectedSolution?.id === solutionId) {
        setSelectedSolution({ ...selectedSolution, upvotes: res.upvotes, user_voted: res.voted });
      }
    } catch {}
  };

  const handleAddComment = async () => {
    if (!selectedId || !newComment.trim()) return;
    setPosting(true);
    try {
      const c = await addSolutionComment(selectedId, newComment.trim());
      setComments(prev => [...prev, c]);
      setNewComment('');
      if (selectedSolution) {
        setSelectedSolution({ ...selectedSolution, comment_count: selectedSolution.comment_count + 1 });
      }
      setSolutions(prev => prev.map(s =>
        s.id === selectedId ? { ...s, comment_count: s.comment_count + 1 } : s
      ));
    } catch (err: any) {
      alert('Failed to post comment: ' + String(err));
    } finally {
      setPosting(false);
    }
  };

  const handleSubmit = async () => {
    if (!submitCode.trim()) return;
    setSubmitting(true);
    const doShare = () =>
      shareSolution({
        exercise_id: exerciseId,
        code: submitCode,
        explanation: submitExplanation.trim() || undefined,
      });
    try {
      try {
        await doShare();
      } catch (err: any) {
        const msg = String(err);
        if (msg.includes('401') || !user) {
          await requireLogin('Please sign in to share your solution.');
          await doShare();
        } else {
          throw err;
        }
      }
      setSubmitExplanation('');
      setTab('mine');
    } catch (err: any) {
      if (err instanceof Error && err.message === 'Login cancelled') {
        // User dismissed login prompt — do nothing.
      } else {
        const msg = String(err);
        if (msg.includes('403')) {
          alert('You must solve this exercise first before sharing a solution.');
        } else {
          alert('Failed to submit: ' + msg);
        }
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (solutionId: number) => {
    if (!confirm('Delete this submission?')) return;
    try {
      await deleteSharedSolution(solutionId);
      setMySolutions(prev => prev.filter(s => s.id !== solutionId));
      setSolutions(prev => prev.filter(s => s.id !== solutionId));
      if (selectedId === solutionId) setSelectedId(null);
    } catch {
      alert('Failed to delete.');
    }
  };

  const list = tab === 'browse' ? solutions : mySolutions;

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[92vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-indigo-50 to-purple-50">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Solutions</h2>
            <p className="text-xs text-gray-500 font-mono mt-0.5">{exerciseName}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 text-2xl leading-none w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/60"
          >
            &times;
          </button>
        </div>

        {/* Tabs */}
        <div className="px-6 border-b border-gray-100 flex items-center gap-1">
          {(['browse', 'mine', 'submit'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => { setSelectedId(null); setTab(t); }}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                tab === t
                  ? 'border-indigo-600 text-indigo-700'
                  : 'border-transparent text-gray-500 hover:text-gray-800'
              }`}
            >
              {t === 'browse' && 'Community Solutions'}
              {t === 'mine' && 'My Submissions'}
              {t === 'submit' && 'Share New'}
            </button>
          ))}
          {tab === 'browse' && (
            <div className="ml-auto flex items-center gap-2 py-2">
              <span className="text-xs text-gray-400">Sort:</span>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SolutionSort)}
                className="text-xs border border-gray-200 rounded px-2 py-1 bg-white"
              >
                <option value="upvotes">Most upvoted</option>
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
              </select>
            </div>
          )}
        </div>

        {/* Body — min-h-0 so flex children can shrink below content size and actually scroll */}
        <div className="flex-1 min-h-0 overflow-hidden flex">
          {/* Left: list (hidden when submit tab or when detail is open in single-column mode) */}
          {tab !== 'submit' && (
            <div className={`${selectedId ? 'w-80 border-r border-gray-100' : 'flex-1'} min-h-0 h-full overflow-y-scroll solutions-scroll`}>
              {loading && <div className="p-8 text-center text-sm text-gray-400">Loading&hellip;</div>}
              {error && !loading && (
                <div className="p-8 text-center text-sm text-red-500">{error}</div>
              )}
              {!loading && !error && list.length === 0 && (
                <div className="p-8 text-center text-sm text-gray-400">
                  {tab === 'browse' ? 'No solutions shared yet. Be the first!' : 'You haven\u2019t shared any solutions yet.'}
                </div>
              )}
              {!loading && !error && list.length > 0 && (
                <div className="divide-y divide-gray-50">
                  {list.map(s => {
                    const isOwn = user?.id === s.user_id;
                    const expanded = expandedIds.has(s.id);
                    // When sidebar mode (a detail is open), always clamp to 10 lines.
                    // Otherwise collapsed=5 lines, expanded=full code.
                    const maxLines = selectedId ? 10 : (expanded ? undefined : 5);
                    const lineCount = s.code.split('\n').length;
                    const canExpand = !selectedId && lineCount > 5;
                    return (
                      <div
                        key={s.id}
                        className={`p-4 hover:bg-indigo-50/30 transition-colors ${
                          selectedId === s.id ? 'bg-indigo-50' : ''
                        }`}
                      >
                        {/* Header: click opens full detail view */}
                        <div
                          onClick={() => openSolution(s.id)}
                          className="flex items-start justify-between gap-3 mb-2 cursor-pointer"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
                              {(s.display_name || s.username).charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-gray-900 truncate">
                                {s.display_name || s.username}
                                {isOwn && <span className="ml-1 text-[10px] text-indigo-500">(you)</span>}
                              </div>
                              <div className="text-[11px] text-gray-400">{formatDate(s.created_at)}</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <span
                              onClick={(e) => { e.stopPropagation(); handleVote(s.id); }}
                              className={`text-xs font-medium cursor-pointer px-2 py-0.5 rounded-full border transition-colors ${
                                s.user_voted
                                  ? 'border-indigo-300 bg-indigo-100 text-indigo-700'
                                  : 'border-gray-200 text-gray-500 hover:border-indigo-300 hover:text-indigo-600'
                              }`}
                            >
                              &#9650; {s.upvotes}
                            </span>
                          </div>
                        </div>
                        {s.explanation && (
                          <p className="text-xs text-gray-600 mb-2 whitespace-pre-wrap">{s.explanation}</p>
                        )}
                        <CoqCodeBlock code={s.code} maxLines={maxLines} />
                        <div className="flex items-center gap-3 mt-2 text-[11px] text-gray-400">
                          <span>&#128172; {s.comment_count}</span>
                          {canExpand && (
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleExpand(s.id); }}
                              className="text-indigo-600 hover:text-indigo-800 font-semibold"
                            >
                              {expanded ? '\u25B2 Collapse' : `\u25BC Expand (${lineCount} lines)`}
                            </button>
                          )}
                          <button
                            onClick={() => openSolution(s.id)}
                            className="text-indigo-500 hover:text-indigo-700 font-medium"
                          >
                            Open &amp; comment &rarr;
                          </button>
                          {isOwn && (
                            <span
                              onClick={(e) => { e.stopPropagation(); handleDelete(s.id); }}
                              className="ml-auto text-red-400 hover:text-red-600 cursor-pointer"
                            >
                              delete
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Right: detail view */}
          {tab !== 'submit' && selectedId !== null && (
            <div className="flex-1 min-h-0 h-full overflow-y-scroll solutions-scroll bg-gray-50/30">
              {!selectedSolution ? (
                <div className="p-8 text-center text-sm text-gray-400">Loading&hellip;</div>
              ) : (
                <div className="p-6">
                  {/* Author header */}
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-white text-sm font-bold">
                        {(selectedSolution.display_name || selectedSolution.username).charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="text-sm font-bold text-gray-900">
                          {selectedSolution.display_name || selectedSolution.username}
                        </div>
                        <div className="text-xs text-gray-400">
                          submitted {formatDate(selectedSolution.created_at)}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => handleVote(selectedSolution.id)}
                      className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
                        selectedSolution.user_voted
                          ? 'border-indigo-400 bg-indigo-100 text-indigo-700'
                          : 'border-gray-200 text-gray-600 hover:border-indigo-300 hover:text-indigo-600'
                      }`}
                    >
                      &#9650; {selectedSolution.upvotes} upvote{selectedSolution.upvotes !== 1 && 's'}
                    </button>
                  </div>

                  {/* Explanation */}
                  {selectedSolution.explanation && (
                    <div className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-100 text-sm text-amber-900 whitespace-pre-wrap">
                      {selectedSolution.explanation}
                    </div>
                  )}

                  {/* Code — full syntax-highlighted (matches lecture theme) */}
                  <div className="mb-6">
                    <CoqCodeBlock code={selectedSolution.code} />
                  </div>

                  {/* Comments */}
                  <div className="border-t border-gray-200 pt-4">
                    <h3 className="text-sm font-bold text-gray-900 mb-3">
                      Comments ({comments.length})
                    </h3>

                    <div className="space-y-3 mb-4">
                      {comments.length === 0 && (
                        <p className="text-xs text-gray-400 italic">No comments yet. Start the discussion!</p>
                      )}
                      {comments.map(c => (
                        <div key={c.id} className="flex items-start gap-2">
                          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-gray-400 to-gray-500 flex items-center justify-center text-white text-[11px] font-bold shrink-0">
                            {(c.display_name || c.username).charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 bg-white border border-gray-100 rounded-lg p-3">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs font-semibold text-gray-800">
                                {c.display_name || c.username}
                              </span>
                              <span className="text-[10px] text-gray-400">{formatDate(c.created_at)}</span>
                            </div>
                            <p className="text-xs text-gray-700 whitespace-pre-wrap">{c.content}</p>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* New comment input */}
                    <div className="flex items-start gap-2">
                      <textarea
                        value={newComment}
                        onChange={(e) => setNewComment(e.target.value)}
                        placeholder="Write a comment&hellip;"
                        className="flex-1 text-xs p-2.5 border border-gray-200 rounded-lg resize-none focus:outline-none focus:border-indigo-400"
                        rows={2}
                      />
                      <button
                        onClick={handleAddComment}
                        disabled={posting || !newComment.trim()}
                        className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-medium disabled:opacity-40"
                      >
                        {posting ? 'Posting&hellip;' : 'Post'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Submit tab — flex column so the editor fills available space and
              the Cancel/Share footer is ALWAYS visible at the bottom of the
              modal regardless of viewport height. */}
          {tab === 'submit' && (
            <div className="flex-1 min-h-0 h-full flex flex-col">
              {/* Scrollable form area */}
              <div className="flex-1 min-h-0 overflow-y-auto solutions-scroll p-6 flex flex-col">
                <p className="text-sm text-gray-600 mb-4 shrink-0">
                  Share a solution for <span className="font-mono font-semibold">{exerciseName}</span>. You can submit multiple different approaches; each one is saved with its own timestamp.
                </p>
                {/* Visible diagnostic — captured currentCode length on mount.
                    If this says 0 the modal received empty bytes and the
                    "Use current solution" button is your way out. */}
                <p className="text-[11px] text-gray-400 mb-2 shrink-0 font-mono">
                  Captured at open: {currentCode?.length ?? 0} chars
                  {(!currentCode || currentCode.length === 0) && (
                    <span className="text-amber-600 ml-2">
                      {'\u26A0 empty \u2014 click "Use current solution" to load it from your editor.'}
                    </span>
                  )}
                </p>

                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5 shrink-0">
                  Explanation (optional)
                </label>
                <textarea
                  value={submitExplanation}
                  onChange={(e) => setSubmitExplanation(e.target.value)}
                  placeholder="Briefly describe your approach or what makes this solution interesting&hellip;"
                  rows={2}
                  className="w-full text-sm p-3 border border-gray-200 rounded-lg resize-none focus:outline-none focus:border-indigo-400 mb-4 shrink-0"
                />

                <div className="flex items-center justify-between mb-1.5 shrink-0">
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider">
                    Code
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const fresh = (getLatestCode ? getLatestCode() : currentCode) ?? '';
                      // eslint-disable-next-line no-console
                      console.log('[SolutionsModal] Use current solution clicked', {
                        len: fresh.length,
                        preview: fresh.slice(0, 200),
                        haveEditorRef: !!editorRef.current,
                      });
                      if (editorRef.current) {
                        editorRef.current.setValue(fresh);
                      }
                      setSubmitCode(fresh);
                      // Surface the value so user can see it even if the editor
                      // somehow refuses to render — alert is intentional and
                      // temporary; remove once we've confirmed the data path.
                      if (!fresh) {
                        alert('Use current solution: got EMPTY code from the live block. Open DevTools console for details.');
                      }
                    }}
                    className="text-[11px] font-medium text-indigo-600 hover:text-indigo-800 px-2 py-1 rounded hover:bg-indigo-50 border border-indigo-200 hover:border-indigo-300"
                    title="Replace the editor content below with the code you currently have for this exercise"
                  >
                    {'\u2193 Use current solution'}
                  </button>
                </div>
                <div className="flex-1 min-h-[220px] border border-gray-200 rounded-lg overflow-hidden bg-white">
                  {/* Use `defaultValue` (uncontrolled init), not `value`.
                      @monaco-editor/react's controlled `value` prop has a race
                      with the lazy Monaco loader where the initial content can
                      end up blank on first mount. State is still tracked via
                      onChange; on tab-switch remount, defaultValue=submitCode
                      preserves whatever the user already typed. */}
                  <Editor
                    height="100%"
                    language={COQ_LANGUAGE_ID}
                    theme="coqTheme"
                    defaultValue={submitCode}
                    onChange={(v) => setSubmitCode(v ?? '')}
                    beforeMount={handleBeforeMount}
                    onMount={handleEditorMount}
                    options={{
                      fontSize: 13,
                      fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                      minimap: { enabled: false },
                      lineNumbers: 'on',
                      wordWrap: 'on',
                      scrollBeyondLastLine: false,
                      tabSize: 2,
                      automaticLayout: true,
                      padding: { top: 10, bottom: 10 },
                    }}
                  />
                </div>
              </div>

              {/* Pinned footer — always visible */}
              <div className="shrink-0 border-t border-gray-100 px-6 py-3 flex items-center justify-end gap-2 bg-white">
                <button
                  onClick={() => setTab('browse')}
                  className="text-sm text-gray-600 hover:text-gray-900 px-4 py-2"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={submitting || !submitCode.trim()}
                  className="text-sm bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2 rounded-lg font-semibold disabled:opacity-40 shadow-sm"
                >
                  {submitting ? 'Submitting\u2026' : 'Share solution'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
