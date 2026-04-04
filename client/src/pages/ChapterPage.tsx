import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import Editor, { type OnMount, type BeforeMount } from '@monaco-editor/react';
import GoalsPanel from '../components/GoalsPanel';
import CommentBlock from '../components/CommentBlock';
import ContextPanel, { parseContextEntries, getContextNames } from '../components/ContextPanel';
import TacticsPanel from '../components/TacticsPanel';
import { registerCoqLanguage, COQ_LANGUAGE_ID, setCompletionContext } from '../components/coqLanguage';
import {
  createCoqSession,
  closeCoqSession,
  coqStep,
  coqCancel,
  getChapterBlocks,
  saveChapterFile,
  getExercises,
  type BlockData,
  type TocEntry,
} from '../api/client';
import type { CoqGoal, Exercise } from '../types';

/**
 * Split Coq source into individual sentences.
 *
 * Strategy: first strip all comments, then split on sentence-ending periods.
 * This avoids the complexity of tracking comment state during sentence detection.
 * Comments are NOT Coq sentences — SerAPI ignores them anyway.
 */
function splitSentences(code: string): string[] {
  // Step 1: Remove all comments (* ... *), handling nesting
  let stripped = '';
  let i = 0;
  while (i < code.length) {
    if (code[i] === '(' && i + 1 < code.length && code[i + 1] === '*') {
      // Enter comment — skip until matching *)
      let depth = 1;
      i += 2;
      while (i < code.length && depth > 0) {
        if (code[i] === '(' && i + 1 < code.length && code[i + 1] === '*') { depth++; i += 2; }
        else if (code[i] === '*' && i + 1 < code.length && code[i + 1] === ')') { depth--; i += 2; }
        else i++;
      }
      stripped += ' '; // Replace comment with space to preserve word boundaries
    } else {
      stripped += code[i];
      i++;
    }
  }

  // Step 2: Split on sentence-ending periods
  // A Coq sentence ends with '.' followed by whitespace, ')' or EOF
  const sentences: string[] = [];
  let start = 0;
  i = 0;

  // Skip leading whitespace
  while (i < stripped.length && /\s/.test(stripped[i])) i++;
  start = i;

  while (i < stripped.length) {
    // Skip strings
    if (stripped[i] === '"') {
      i++;
      while (i < stripped.length && stripped[i] !== '"') i++;
      if (i < stripped.length) i++;
      continue;
    }

    // Check for sentence-ending period
    if (stripped[i] === '.') {
      const next = i + 1 < stripped.length ? stripped[i + 1] : ' ';
      // Period is sentence-ending if followed by whitespace, ) or EOF
      // But NOT if it's part of a qualified name (e.g., "Nat.add") — those have no space before
      if (/[\s)]/.test(next) || i + 1 >= stripped.length) {
        const sentence = stripped.slice(start, i + 1).trim();
        if (sentence && sentence !== '.') {
          sentences.push(sentence);
        }
        i++;
        while (i < stripped.length && /\s/.test(stripped[i])) i++;
        start = i;
        continue;
      }
    }

    i++;
  }

  // Leftover (shouldn't happen with well-formed Coq)
  const remaining = stripped.slice(start).trim();
  if (remaining && remaining !== '.') {
    sentences.push(remaining);
  }

  return sentences;
}

interface SentenceRecord {
  sid: number;
  blockId: number;
  sentenceIdx: number;
  text: string;
}

export default function ChapterPage() {
  const { volumeId, chapterName } = useParams<{ volumeId: string; chapterName: string }>();
  const [blocks, setBlocks] = useState<BlockData[]>([]);
  const [toc, setToc] = useState<TocEntry[]>([]);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [goals, setGoals] = useState<CoqGoal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeBlockId, setActiveBlockId] = useState<number | null>(null);
  // Track executed sentences per block: blockId -> number of sentences executed
  const [executedSentences, setExecutedSentences] = useState<Map<number, number>>(new Map());
  const executedSentencesRef = useRef<Map<number, number>>(new Map());
  // Keep ref in sync with state
  useEffect(() => { executedSentencesRef.current = executedSentences; }, [executedSentences]);
  const sentenceStackRef = useRef<SentenceRecord[]>([]);
  const blockContentsRef = useRef<Map<number, string>>(new Map());
  const blockRefsMap = useRef<Map<number, HTMLDivElement>>(new Map());
  const [rightTab, setRightTab] = useState<'goals' | 'context' | 'tactics'>('goals');
  const editorInstancesRef = useRef<Map<number, any>>(new Map());
  const monacoInstanceRef = useRef<any>(null);
  const [tocOpen, setTocOpen] = useState(true);

  // Load blocks and exercises
  useEffect(() => {
    if (!volumeId || !chapterName) return;
    getChapterBlocks(volumeId, chapterName).then(data => {
      setBlocks(data.blocks);
      setToc(data.toc);
      data.blocks.forEach(b => blockContentsRef.current.set(b.id, b.content));
    });
    getExercises(volumeId, chapterName).then(setExercises).catch(console.error);
  }, [volumeId, chapterName]);

  // Create Coq session
  useEffect(() => {
    if (!volumeId) return;
    let sid: string | null = null;
    createCoqSession(volumeId, chapterName)
      .then(s => { sid = s.session_id; setSessionId(s.session_id); })
      .catch(console.error);
    return () => { if (sid) closeCoqSession(sid).catch(() => {}); };
  }, [volumeId, chapterName]);

  const handleBeforeMount: BeforeMount = (monaco) => {
    registerCoqLanguage(monaco);
    monacoInstanceRef.current = monaco;
  };

  // Update editor decorations to show executed region
  const updateEditorDecorations = useCallback((blockId: number, executedCount: number) => {
    const editor = editorInstancesRef.current.get(blockId);
    const monaco = monacoInstanceRef.current;
    if (!editor || !monaco) return;

    const content = blockContentsRef.current.get(blockId) || '';
    const sentences = splitSentences(content);

    // Find the end position of the last executed sentence
    let offset = 0;
    for (let i = 0; i < Math.min(executedCount, sentences.length); i++) {
      const idx = content.indexOf(sentences[i], offset);
      if (idx >= 0) {
        offset = idx + sentences[i].length;
      }
    }

    const model = editor.getModel();
    if (!model) return;

    const endPos = model.getPositionAt(offset);
    const range = new monaco.Range(1, 1, endPos.lineNumber, endPos.column);

    const decorationKey = `_coqExecuted_${blockId}`;
    const oldDecorations = (editor as any)[decorationKey] || [];
    (editor as any)[decorationKey] = editor.deltaDecorations(
      oldDecorations,
      executedCount > 0
        ? [{
            range,
            options: {
              className: 'coq-executed-region',
              isWholeLine: false,
            },
          }]
        : [],
    );
  }, []);

  /**
   * Invalidate execution from a given block onward.
   * When the user edits an already-executed block, we must cancel
   * all sentences from that block forward — just like VSCode Coq plugin.
   */
  const invalidateFrom = useCallback(async (fromBlockId: number) => {
    if (!sessionId) return;

    // Find all sentences that belong to this block or later blocks
    const toCancel: SentenceRecord[] = [];
    const toKeep: SentenceRecord[] = [];
    for (const rec of sentenceStackRef.current) {
      if (rec.blockId >= fromBlockId) {
        toCancel.push(rec);
      } else {
        toKeep.push(rec);
      }
    }

    if (toCancel.length === 0) return;

    // Cancel from the earliest sentence in the affected range
    const earliestSid = toCancel[0].sid;
    try {
      const result = await coqCancel(sessionId, earliestSid);
      // Update goals from the cancel response
      if (toKeep.length > 0) {
        setGoals(result.goals);
      } else {
        setGoals(null);
      }
    } catch {
      // If cancel fails, still clean up UI state
      setGoals(null);
    }

    // Update state
    sentenceStackRef.current = toKeep;

    // Clear executed counts for affected blocks
    const affectedBlockIds = new Set(toCancel.map(r => r.blockId));
    setExecutedSentences(prev => {
      const next = new Map(prev);
      for (const bid of affectedBlockIds) {
        next.delete(bid);
      }
      return next;
    });

    // Clear decorations for affected blocks
    for (const bid of affectedBlockIds) {
      updateEditorDecorations(bid, 0);
    }

    setError(null);
  }, [sessionId, updateEditorDecorations]);

  const handleEditorMount = (blockId: number): OnMount => (editor, _monaco) => {
    editorInstancesRef.current.set(blockId, editor);

    // Auto-resize
    const updateHeight = () => {
      const contentHeight = editor.getContentHeight();
      const container = editor.getDomNode()?.parentElement;
      if (container) {
        container.style.height = `${Math.max(contentHeight, 36)}px`;
        editor.layout();
      }
    };
    editor.onDidContentSizeChange(updateHeight);
    setTimeout(updateHeight, 50);

    // Track content changes AND invalidate execution on edit
    editor.onDidChangeModelContent(() => {
      const newContent = editor.getModel()?.getValue() || '';
      const oldContent = blockContentsRef.current.get(blockId) || '';
      blockContentsRef.current.set(blockId, newContent);

      // If this block has executed sentences and the content changed,
      // invalidate from this block onward (like VSCode Coq plugin)
      const execCount = executedSentencesRef.current.get(blockId) || 0;
      if (execCount > 0 && newContent !== oldContent) {
        invalidateFrom(blockId);
      }
    });

    // Focus
    editor.onDidFocusEditorText(() => setActiveBlockId(blockId));
  };

  /**
   * Find the next unexecuted sentence globally, scanning blocks from the top.
   * This matches VSCode behavior: step always proceeds sequentially through the file.
   */
  const findNextUnexecuted = useCallback((): { blockId: number; sentenceIdx: number; sentence: string } | null => {
    for (const block of blocks) {
      if (block.kind === 'section_header' || block.kind === 'subsection_header' || block.kind === 'comment') continue;
      const content = blockContentsRef.current.get(block.id) || '';
      const sentences = splitSentences(content);
      const alreadyExecuted = executedSentencesRef.current.get(block.id) || 0;
      if (alreadyExecuted < sentences.length) {
        return { blockId: block.id, sentenceIdx: alreadyExecuted, sentence: sentences[alreadyExecuted] };
      }
    }
    return null;
  }, [blocks]);

  /**
   * Execute the next sentence globally (like VSCode's Ctrl+Alt+Down).
   * Always proceeds sequentially from the top — never skips blocks.
   */
  const stepForward = useCallback(async () => {
    if (!sessionId || loading) return;

    const next = findNextUnexecuted();
    if (!next) return; // Everything executed

    setLoading(true);
    setError(null);
    setActiveBlockId(next.blockId);

    // Scroll to the block if needed
    blockRefsMap.current.get(next.blockId)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    try {
      const result = await coqStep(sessionId, next.sentence);
      if (result.error) {
        setError(result.error);
        setGoals(null);
      } else {
        sentenceStackRef.current.push({
          sid: result.sid,
          blockId: next.blockId,
          sentenceIdx: next.sentenceIdx,
          text: next.sentence,
        });
        const newCount = next.sentenceIdx + 1;
        setExecutedSentences(prev => new Map(prev).set(next.blockId, newCount));
        updateEditorDecorations(next.blockId, newCount);
        setGoals(result.goals);
        setError(null);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [sessionId, loading, findNextUnexecuted, updateEditorDecorations]);

  /**
   * Undo the last executed sentence.
   */
  const stepBack = useCallback(async () => {
    if (!sessionId || loading || sentenceStackRef.current.length === 0) return;
    setLoading(true);
    setError(null);

    try {
      const last = sentenceStackRef.current[sentenceStackRef.current.length - 1];
      const result = await coqCancel(sessionId, last.sid);
      sentenceStackRef.current.pop();

      const newCount = (executedSentences.get(last.blockId) || 1) - 1;
      setExecutedSentences(prev => {
        const next = new Map(prev);
        if (newCount <= 0) next.delete(last.blockId);
        else next.set(last.blockId, newCount);
        return next;
      });
      updateEditorDecorations(last.blockId, newCount);
      setGoals(result.goals);
      setError(null);
      setActiveBlockId(last.blockId);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [sessionId, loading, executedSentences, updateEditorDecorations]);

  /**
   * Execute all sentences in all blocks up to and including the target block.
   * This ensures all dependencies are satisfied — just like VSCode which
   * always executes everything from the top of the file.
   */
  const runUpTo = useCallback(async (targetBlockId: number) => {
    if (!sessionId || loading) return;
    setLoading(true);
    setError(null);

    try {
      for (const block of blocks) {
        if (block.id > targetBlockId) break;
        if (block.kind === 'section_header' || block.kind === 'subsection_header' || block.kind === 'comment') continue;

        const content = blockContentsRef.current.get(block.id) || '';
        const sentences = splitSentences(content);
        const alreadyExecuted = executedSentencesRef.current.get(block.id) || 0;

        for (let i = alreadyExecuted; i < sentences.length; i++) {
          const result = await coqStep(sessionId, sentences[i]);
          if (result.error) {
            setError(result.error);
            setActiveBlockId(block.id);
            setGoals(null);
            setLoading(false);
            return;
          }
          sentenceStackRef.current.push({ sid: result.sid, blockId: block.id, sentenceIdx: i, text: sentences[i] });
          const newCount = i + 1;
          setExecutedSentences(prev => new Map(prev).set(block.id, newCount));
          updateEditorDecorations(block.id, newCount);
          setGoals(result.goals);
          setActiveBlockId(block.id);
        }
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [sessionId, loading, blocks, updateEditorDecorations]);

  // Save
  const handleSave = useCallback(async () => {
    if (!volumeId || !chapterName) return;
    setSaving(true);
    try {
      const parts: string[] = [];
      for (const block of blocks) {
        parts.push(blockContentsRef.current.get(block.id) || block.content);
      }
      await saveChapterFile(volumeId, chapterName, parts.join('\n\n'));
    } catch (e: any) {
      setError(`Save failed: ${e.message}`);
    } finally {
      setSaving(false);
    }
  }, [volumeId, chapterName, blocks]);

  const scrollToBlock = (blockId: number) => {
    blockRefsMap.current.get(blockId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActiveBlockId(blockId);
  };

  const getExerciseStatus = (name: string | null) => {
    if (!name) return null;
    return exercises.find(e => e.name === name);
  };

  const getBlockStatus = (blockId: number): 'idle' | 'partial' | 'done' => {
    const count = executedSentences.get(blockId) || 0;
    if (count === 0) return 'idle';
    const content = blockContentsRef.current.get(blockId) || '';
    const total = splitSentences(content).length;
    return count >= total ? 'done' : 'partial';
  };

  // Inject CSS for executed region highlighting
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      .coq-executed-region { background-color: rgba(34, 197, 94, 0.08) !important; }
    `;
    document.head.appendChild(style);
    return () => { document.head.removeChild(style); };
  }, []);

  // Compute all executed sentence texts for the Context panel
  const allExecutedTexts = useMemo(() =>
    sentenceStackRef.current.map(r => r.text),
    // Re-compute when executedSentences changes (triggered by stepping)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [executedSentences]
  );

  // Update auto-completion context when executed sentences change
  useEffect(() => {
    const entries = parseContextEntries(allExecutedTexts);
    const names = getContextNames(entries);
    setCompletionContext(names);
  }, [allExecutedTexts]);

  return (
    <div className="h-screen flex flex-col bg-[#0f1117]">
      {/* Top bar */}
      <div className="h-11 bg-[#16171f] border-b border-gray-800/60 flex items-center px-4 gap-3 shrink-0">
        <Link to={`/volume/${volumeId}`} className="text-sm text-gray-500 hover:text-gray-300">
          &larr; {volumeId?.toUpperCase()}
        </Link>
        <span className="text-sm font-semibold text-gray-200">{chapterName}.v</span>

        <div className="flex items-center gap-2 ml-auto">
          <button onClick={stepBack}
            disabled={loading || sentenceStackRef.current.length === 0}
            className="px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 disabled:opacity-30 rounded-md font-medium"
            title="Undo last sentence (Alt+Up)">
            &#9664; Undo
          </button>
          <button onClick={() => stepForward()}
            disabled={loading || !sessionId}
            className="px-3 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-30 rounded-md font-medium"
            title="Execute next sentence (Alt+Down)">
            {loading ? '...' : 'Step &#9654;'}
          </button>

          <div className="w-px h-5 bg-gray-700" />

          <button onClick={handleSave} disabled={saving}
            className="px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 disabled:opacity-30 rounded-md font-medium">
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button onClick={() => setTocOpen(!tocOpen)}
            className="px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-md font-medium">
            {tocOpen ? 'Hide TOC' : 'TOC'}
          </button>

          <span className={`w-2 h-2 rounded-full ${sessionId ? 'bg-emerald-400' : 'bg-gray-600'}`}
                title={sessionId ? 'Coq session active' : 'Connecting...'} />
        </div>
      </div>

      {/* Main: TOC + Blocks + Goals */}
      <div className="flex-1 flex min-h-0">

        {/* TOC */}
        {tocOpen && (
          <aside className="w-52 shrink-0 bg-[#13141c] border-r border-gray-800/60 overflow-y-auto">
            <div className="p-3">
              <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-3">Contents</h3>
              <nav className="space-y-0.5">
                {toc.map(entry => (
                  <button
                    key={entry.block_id}
                    onClick={() => scrollToBlock(entry.block_id)}
                    className={`block w-full text-left text-xs py-1.5 px-2 rounded-md truncate transition-colors ${
                      activeBlockId === entry.block_id
                        ? 'bg-indigo-950/50 text-indigo-400 font-medium'
                        : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/50'
                    }`}
                    style={{ paddingLeft: `${entry.level * 10}px` }}
                    title={entry.title}
                  >
                    {entry.level === 3 && <span className="text-amber-500 mr-1">&#9733;</span>}
                    {entry.title}
                  </button>
                ))}
              </nav>
            </div>
          </aside>
        )}

        {/* Blocks area */}
        <div className="flex-1 overflow-y-auto min-w-0">
          <div className="max-w-4xl mx-auto py-6 px-4 space-y-1">
            {blocks.map(block => {
              const status = getBlockStatus(block.id);
              const execCount = executedSentences.get(block.id) || 0;
              const content = blockContentsRef.current.get(block.id) || block.content;
              const totalSentences = (block.kind === 'code' || block.kind === 'exercise')
                ? splitSentences(content).length : 0;

              return (
                <div
                  key={block.id}
                  ref={el => { if (el) blockRefsMap.current.set(block.id, el); }}
                >
                  {/* Section header */}
                  {block.kind === 'section_header' && (
                    <h2 className="text-2xl font-bold text-gray-100 pt-10 pb-3 pl-1 border-b border-gray-800 mb-4">
                      {block.title}
                    </h2>
                  )}

                  {/* Subsection header */}
                  {block.kind === 'subsection_header' && (
                    <h3 className="text-lg font-semibold text-gray-300 pt-8 pb-2 pl-1">
                      {block.title}
                    </h3>
                  )}

                  {/* Comment */}
                  {block.kind === 'comment' && (
                    <div className="px-1 py-2">
                      <CommentBlock content={block.content} />
                    </div>
                  )}

                  {/* Code block */}
                  {block.kind === 'code' && (
                    <div
                      className={`rounded-lg border overflow-hidden my-3 transition-all ${
                        status === 'done' ? 'border-emerald-700/50' :
                        status === 'partial' ? 'border-amber-700/50' :
                        activeBlockId === block.id ? 'border-indigo-600/50 ring-1 ring-indigo-500/20' :
                        'border-gray-800'
                      }`}
                      onClick={() => setActiveBlockId(block.id)}
                    >
                      <div className={`flex items-center px-3 py-1 border-b ${
                        status === 'done' ? 'border-emerald-800/40 bg-emerald-950/20' :
                        status === 'partial' ? 'border-amber-800/40 bg-amber-950/20' :
                        'border-gray-800/60 bg-[#1a1b26]'
                      }`}>
                        <span className="text-[10px] font-mono text-gray-600">code</span>
                        {totalSentences > 0 && (
                          <span className={`text-[10px] ml-2 ${
                            status === 'done' ? 'text-emerald-500' :
                            status === 'partial' ? 'text-amber-500' :
                            'text-gray-600'
                          }`}>
                            {execCount}/{totalSentences}
                          </span>
                        )}
                        <div className="ml-auto flex items-center gap-2">
                          {status !== 'done' && (
                            <button
                              onClick={(e) => { e.stopPropagation(); runUpTo(block.id); }}
                              disabled={loading || !sessionId}
                              className="text-[10px] text-indigo-400 hover:text-indigo-300 disabled:opacity-30"
                            >
                              &#9654; run all
                            </button>
                          )}
                          {status === 'done' && (
                            <span className="text-[10px] text-emerald-500">&#10003;</span>
                          )}
                        </div>
                      </div>
                      <Editor
                        height="auto"
                        language={COQ_LANGUAGE_ID}
                        theme="coqTheme"
                        defaultValue={block.content}
                        beforeMount={handleBeforeMount}
                        onMount={handleEditorMount(block.id)}
                        options={{
                          fontSize: 13,
                          fontFamily: "'JetBrains Mono', 'Consolas', 'Courier New', monospace",
                          minimap: { enabled: false },
                          lineNumbers: 'off',
                          wordWrap: 'on',
                          scrollBeyondLastLine: false,
                          tabSize: 2,
                          scrollbar: { vertical: 'hidden', horizontal: 'auto' },
                          overviewRulerLanes: 0, overviewRulerBorder: false,
                          hideCursorInOverviewRuler: true,
                          lineDecorationsWidth: 8,
                          lineNumbersMinChars: 0,
                          glyphMargin: false,
                          folding: false,
                          automaticLayout: true,
                        }}
                      />
                    </div>
                  )}

                  {/* Exercise block */}
                  {block.kind === 'exercise' && (() => {
                    const ex = getExerciseStatus(block.exercise_name);
                    const stars = block.exercise_stars || 0;
                    return (
                      <div
                        className={`rounded-lg border-2 overflow-hidden my-3 transition-all ${
                          status === 'done' ? 'border-emerald-600/50' :
                          status === 'partial' ? 'border-amber-600/50' :
                          activeBlockId === block.id ? 'border-indigo-500/60 ring-1 ring-indigo-500/20' :
                          'border-amber-700/40'
                        }`}
                        onClick={() => setActiveBlockId(block.id)}
                      >
                        <div className={`flex items-center px-4 py-2.5 ${
                          status === 'done' ? 'bg-emerald-950/30' :
                          status === 'partial' ? 'bg-amber-950/30' :
                          'bg-amber-950/20'
                        }`}>
                          <span className="text-amber-400 text-sm mr-2">
                            {'★'.repeat(stars)}{'☆'.repeat(Math.max(0, 5 - stars))}
                          </span>
                          <span className="text-sm font-semibold text-gray-200">
                            {block.exercise_name}
                          </span>
                          <span className="text-xs text-gray-500 ml-2">
                            {block.exercise_difficulty}
                            {block.exercise_modifier ? ` · ${block.exercise_modifier}` : ''}
                          </span>

                          {totalSentences > 0 && (
                            <span className={`text-[10px] ml-3 ${
                              status === 'done' ? 'text-emerald-400' :
                              status === 'partial' ? 'text-amber-400' :
                              'text-gray-600'
                            }`}>
                              {execCount}/{totalSentences}
                            </span>
                          )}

                          <div className="ml-auto flex items-center gap-2">
                            {ex && ex.status === 'completed' && (
                              <span className="text-xs text-emerald-400 font-medium">&#10003; Done</span>
                            )}
                            {status !== 'done' && (
                              <button
                                onClick={(e) => { e.stopPropagation(); runUpTo(block.id); }}
                                disabled={loading || !sessionId}
                                className="text-[10px] text-indigo-400 hover:text-indigo-300 disabled:opacity-30"
                              >
                                &#9654; run all
                              </button>
                            )}
                          </div>
                        </div>

                        <Editor
                          height="auto"
                          language={COQ_LANGUAGE_ID}
                          theme="coqTheme"
                          defaultValue={block.content}
                          beforeMount={handleBeforeMount}
                          onMount={handleEditorMount(block.id)}
                          options={{
                            fontSize: 13,
                            fontFamily: "'JetBrains Mono', 'Consolas', 'Courier New', monospace",
                            minimap: { enabled: false },
                            lineNumbers: 'off',
                            wordWrap: 'on',
                            scrollBeyondLastLine: false,
                            tabSize: 2,
                            scrollbar: { vertical: 'hidden', horizontal: 'auto' },
                            overviewRulerLanes: 0, overviewRulerBorder: false,
                            hideCursorInOverviewRuler: true,
                            lineDecorationsWidth: 8,
                            lineNumbersMinChars: 0,
                            glyphMargin: false,
                            folding: false,
                            automaticLayout: true,
                          }}
                        />
                      </div>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right panel: Goals / Context / Tactics */}
        <div className="w-96 shrink-0 flex flex-col bg-[#13141c] border-l border-gray-800/60">
          {/* Tabs */}
          <div className="flex border-b border-gray-800/60 shrink-0">
            {(['goals', 'context', 'tactics'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setRightTab(tab)}
                className={`flex-1 text-xs py-2.5 font-medium transition-colors ${
                  rightTab === tab
                    ? 'text-indigo-400 border-b-2 border-indigo-500 bg-indigo-950/30'
                    : 'text-gray-500 hover:text-gray-400 hover:bg-gray-800/30'
                }`}
              >
                {tab === 'goals' ? 'Goals' : tab === 'context' ? 'Context' : 'Tactics'}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 min-h-0 overflow-hidden">
            {rightTab === 'goals' && <GoalsPanel goals={goals} error={error} />}
            {rightTab === 'context' && (
              <ContextPanel executedSentences={allExecutedTexts} />
            )}
            {rightTab === 'tactics' && <TacticsPanel />}
          </div>
        </div>
      </div>
    </div>
  );
}
