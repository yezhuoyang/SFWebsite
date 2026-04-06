import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import Editor, { type OnMount, type BeforeMount } from '@monaco-editor/react';
import GoalsPanel from '../components/GoalsPanel';
import CommentBlock from '../components/CommentBlock';
import ContextPanel, { parseContextEntries, getContextNames } from '../components/ContextPanel';
import TacticsPanel from '../components/TacticsPanel';
import TutorChat, { type GpsAnchor, type TutorChatHandle, renderMarkdown as renderTutorMarkdown } from '../components/TutorChat';
import { ppToString } from '../components/PpDisplay';
import { registerCoqLanguage, COQ_LANGUAGE_ID, setCompletionContext } from '../components/coqLanguage';
// import { getSectionIcon } from '../components/SectionIcons';
import {
  createCoqSession,
  closeCoqSession,
  getChapterBlocks,
  saveChapterFile,
  resetChapterFile,
  getExercises,
  getExerciseSolution,
  explainOutput,
  type BlockData,
  type TocEntry,
  type SaveResult,
  type SolutionData,
} from '../api/client';
import { useCoqWebSocket } from '../api/coqWebSocket';
import type { Exercise } from '../types';

export default function ChapterPage() {
  const { volumeId, chapterName } = useParams<{ volumeId: string; chapterName: string }>();
  const [blocks, setBlocks] = useState<BlockData[]>([]);
  const [toc, setToc] = useState<TocEntry[]>([]);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<SaveResult | null>(null);
  const [visibleSolution, setVisibleSolution] = useState<{ name: string; data: SolutionData } | null>(null);
  const [activeBlockId, setActiveBlockId] = useState<number | null>(null);
  const [tocOpen, setTocOpen] = useState(true);
  const [rightTab, setRightTab] = useState<'goals' | 'context' | 'tactics' | 'history'>('goals');
  const [tocWidth, setTocWidth] = useState(208);   // default 13rem (w-52)
  const [rightWidth, setRightWidth] = useState(384); // default 24rem (w-96)
  const tocAsideRef = useRef<HTMLElement>(null);
  const rightPanelRef = useRef<HTMLDivElement>(null);
  const [tutorOpen, setTutorOpen] = useState(false);
  const tutorBoxRef = useRef<HTMLDivElement>(null);
  const tutorChatRef = useRef<TutorChatHandle>(null);

  const blockContentsRef = useRef<Map<number, string>>(new Map());
  const blockRefsMap = useRef<Map<number, HTMLDivElement>>(new Map());
  const editorInstancesRef = useRef<Map<number, any>>(new Map());
  const monacoRef = useRef<any>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const originalDocRef = useRef<string>(''); // The full original .v file text

  // Activity tracking (not persisted — session only)
  // Detailed events: each entry has a description like "Added '.' at line 43, col 25"
  interface ActivityEvent {
    blockId: number;
    timestamp: number;
    action: string;       // short verb: edit|focus|run|step|navigate
    description: string;  // human-readable: "Added '.' at line 43" etc.
  }
  const editHistoryRef = useRef<ActivityEvent[]>([]);
  const [activityVersion, setActivityVersion] = useState(0);  // bumped when history updates, to trigger re-render
  const [viewedBlockId, setViewedBlockId] = useState<number | null>(null);  // block currently in viewport
  const [cursorInfo, setCursorInfo] = useState<{
    blockId: number;
    localLine: number;      // 1-indexed within the block
    column: number;         // 1-indexed
    charBefore: string;     // character before cursor
    charAfter: string;      // character at/after cursor
  } | null>(null);

  // Inline explanation state (refreshes when Goals change)
  const [explanation, setExplanation] = useState<string | null>(null);
  const [explainLoading, setExplainLoading] = useState(false);
  const [dirtyBlockIds, setDirtyBlockIds] = useState<Set<number>>(new Set()); // Blocks edited since last sync
  // Map of block.id -> starting line number in the rebuilt document (1-indexed)
  const [blockStartLines, setBlockStartLines] = useState<Map<number, number>>(new Map());
  // Refs so editor-command closures see current values
  const blockStartLinesRef = useRef<Map<number, number>>(new Map());
  const coqActionsRef = useRef<ReturnType<typeof useCoqWebSocket>[1] | null>(null);
  const syncThenDoRef = useRef<((action: () => void) => void) | null>(null);

  // WebSocket connection to vscoqtop
  const [coqState, coqActions] = useCoqWebSocket(sessionId);

  // Load blocks and exercises
  useEffect(() => {
    if (!volumeId || !chapterName) return;
    getChapterBlocks(volumeId, chapterName).then(data => {
      setBlocks(data.blocks);
      setToc(data.toc);
      data.blocks.forEach(b => blockContentsRef.current.set(b.id, b.content));
      // Build the canonical document from blocks — this is our source of truth
      originalDocRef.current = data.blocks.map(b => b.content).join('\n');
    });
    getExercises(volumeId, chapterName).then(setExercises).catch(console.error);
  }, [volumeId, chapterName]);

  // Once session + blocks are both ready, sync the canonical document to vscoqtop
  useEffect(() => {
    if (!sessionId || !coqState.connected || blocks.length === 0) return;
    // Send the block-concatenated document so vscoqtop and frontend agree
    const canonicalDoc = blocks.map(b => blockContentsRef.current.get(b.id) || b.content).join('\n');
    coqActions.sendChange(canonicalDoc);
    originalDocRef.current = canonicalDoc;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, coqState.connected, blocks.length > 0]);

  // Create vscoqtop session
  useEffect(() => {
    if (!volumeId || !chapterName) return;
    let sid: string | null = null;
    createCoqSession(volumeId, chapterName)
      .then(s => { sid = s.session_id; setSessionId(s.session_id); })
      .catch(e => console.error('Failed to create session:', e));
    return () => { if (sid) closeCoqSession(sid).catch(() => {}); };
  }, [volumeId, chapterName]);

  // Auto-switch to Goals tab when errors appear
  useEffect(() => {
    if (coqState.diagnostics.some(d => d.severity === 1)) {
      setRightTab('goals');
    }
  }, [coqState.diagnostics]);

  // Apply highlight decorations from vscoqtop's processedRange
  useEffect(() => {
    if (!coqState.highlights || !monacoRef.current) return;
    // vscoqtop sent fresh highlights — clear dirty flags since it re-evaluated
    setDirtyBlockIds(new Set());
    const { processedRange, processingRange } = coqState.highlights;

    // Apply decorations to all editors
    editorInstancesRef.current.forEach((editor, blockId) => {
      const block = blocks.find(b => b.id === blockId);
      if (!block) return;

      // Use DYNAMIC start line from blockStartLines (accounts for edits)
      // vscoqtop uses 0-indexed line numbers; our blockStartLines is 1-indexed.
      const blockStartLine = (blockStartLines.get(blockId) || 1) - 1; // 0-indexed
      const content = blockContentsRef.current.get(blockId) || block.content;
      const blockLineCount = content.split('\n').length;
      const blockEndLine = blockStartLine + blockLineCount - 1;
      const monaco = monacoRef.current;

      const blockDecorations: any[] = [];

      for (const range of processedRange || []) {
        const rStart = range.start.line;
        const rEnd = range.end.line;

        if (rEnd < blockStartLine || rStart > blockEndLine) continue;

        const localStartLine = Math.max(rStart - blockStartLine, 0) + 1;
        const localEndLine = Math.min(rEnd - blockStartLine, blockLineCount - 1) + 1;
        const localStartChar = rStart >= blockStartLine ? range.start.character + 1 : 1;
        const localEndChar = rEnd <= blockEndLine ? range.end.character + 1 : 999;

        blockDecorations.push({
          range: new monaco.Range(localStartLine, localStartChar, localEndLine, localEndChar),
          options: { className: 'coq-processed', isWholeLine: false },
        });
      }

      for (const range of processingRange || []) {
        const rStart = range.start.line;
        const rEnd = range.end.line;
        if (rEnd < blockStartLine || rStart > blockEndLine) continue;

        const localStartLine = Math.max(rStart - blockStartLine, 0) + 1;
        const localEndLine = Math.min(rEnd - blockStartLine, blockLineCount - 1) + 1;

        blockDecorations.push({
          range: new monaco.Range(localStartLine, 1, localEndLine, 999),
          options: { className: 'coq-processing', isWholeLine: false },
        });
      }

      const key = `_coqHighlights_${blockId}`;
      (editor as any)[key] = editor.deltaDecorations(
        (editor as any)[key] || [],
        blockDecorations,
      );
    });
  }, [coqState.highlights, blocks, blockStartLines]);

  const handleBeforeMount: BeforeMount = (monaco) => {
    registerCoqLanguage(monaco);
    monacoRef.current = monaco;
  };

  const handleEditorMount = (blockId: number): OnMount => (editor, monaco) => {
    editorInstancesRef.current.set(blockId, editor);

    // VsRocq keybindings — Alt+Down step forward, Alt+Up step back,
    // Alt+Right interpret to cursor, Alt+End interpret to end
    const logStep = (description: string) => {
      editHistoryRef.current.push({
        blockId, timestamp: Date.now(), action: 'step', description,
      });
      if (editHistoryRef.current.length > 100) editHistoryRef.current.shift();
      setActivityVersion(v => v + 1);
    };
    // Use a wrapper that always reads the latest ref values
    const doStep = (desc: string, action: () => void) => {
      logStep(desc);
      /* cursor movement disabled */  // allow moveCursor to fire
      const sync = syncThenDoRef.current;
      if (sync) { sync(action); } else { action(); }
    };
    editor.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.DownArrow, () => {
      doStep('Alt+Down: step forward', () => coqActionsRef.current!.stepForward());
    });
    editor.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.UpArrow, () => {
      doStep('Alt+Up: step backward', () => coqActionsRef.current!.stepBackward());
    });
    editor.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.RightArrow, () => {
      const pos = editor.getPosition();
      if (pos) {
        const absLine = (blockStartLinesRef.current.get(blockId) || 1) + pos.lineNumber - 1 - 1;
        doStep(`Alt+Right: interpret to cursor (line ${absLine + 1})`, () =>
          coqActionsRef.current!.interpretToPoint(absLine, 9999));
      }
    });
    editor.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.End, () => {
      doStep('Alt+End: interpret to end', () => coqActionsRef.current!.interpretToEnd());
    });

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

    // Track content changes and debounce-sync to vscoqtop
    editor.onDidChangeModelContent((ev: any) => {
      const newContent = editor.getModel()?.getValue() || '';
      blockContentsRef.current.set(blockId, newContent);

      // Record edit in history with granular detail
      // ev.changes is an array of { range, text, rangeLength }
      // - text is what was inserted (empty if pure delete)
      // - rangeLength is how many chars were removed
      try {
        for (const change of (ev.changes || [])) {
          const localLine = change.range?.startLineNumber || 0;
          const absLine = (blockStartLinesRef.current.get(blockId) || 1) + localLine - 1;
          const col = change.range?.startColumn || 0;
          const inserted = change.text || '';
          const removed = change.rangeLength || 0;
          let description: string;
          if (inserted && removed > 0) {
            const shown = inserted.length > 20 ? inserted.slice(0, 20) + '\u2026' : inserted;
            description = `Replaced ${removed} char${removed>1?'s':''} with '${shown.replace(/\n/g, '\u21B5')}' at line ${absLine}, col ${col}`;
          } else if (inserted) {
            const shown = inserted.length > 20 ? inserted.slice(0, 20) + '\u2026' : inserted;
            description = `Added '${shown.replace(/\n/g, '\u21B5')}' at line ${absLine}, col ${col}`;
          } else if (removed > 0) {
            description = `Deleted ${removed} char${removed>1?'s':''} at line ${absLine}, col ${col}`;
          } else {
            description = `Edit at line ${absLine}, col ${col}`;
          }
          editHistoryRef.current.push({
            blockId, timestamp: Date.now(), action: 'edit', description,
          });
        }
        if (editHistoryRef.current.length > 100) {
          editHistoryRef.current.splice(0, editHistoryRef.current.length - 100);
        }
        setActivityVersion(v => v + 1);
      } catch {}

      // Recompute line numbers — all subsequent blocks shift when this block grows/shrinks
      recomputeStartLines();

      // Mark this block and all subsequent blocks as dirty.
      // Skip the update if the set already contains this block (common case during typing).
      setDirtyBlockIds(prev => {
        if (prev.has(blockId)) return prev;  // already marked dirty, no-op
        const next = new Set(prev);
        for (const b of blocks) {
          if (b.id >= blockId && (b.kind === 'code' || b.kind === 'exercise')) {
            next.add(b.id);
          }
        }
        return next;
      });

      // Mark that the document is dirty — do NOT send didChange here.
      // Only send when user explicitly steps (Alt+Down/Up, Run).
      // This prevents vscoqtop from parsing incomplete code mid-typing
      // (e.g., typing a comment like "(*ANum*)" before a tactic).
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = 'dirty' as any;  // non-null sentinel = dirty
    });

    editor.onDidFocusEditorText(() => {
      setActiveBlockId(blockId);
      const b = blocks.find(bl => bl.id === blockId);
      const label = b?.title || b?.exercise_name || `block ${blockId}`;
      editHistoryRef.current.push({
        blockId, timestamp: Date.now(), action: 'focus',
        description: `Focused editor in "${label}"`,
      });
      if (editHistoryRef.current.length > 100) editHistoryRef.current.shift();
      setActivityVersion(v => v + 1);
    });

    // When editor loses focus, update its line numbers (they were skipped during typing)
    editor.onDidBlurEditorText(() => {
      const start = blockStartLinesRef.current.get(blockId) || 1;
      editor.updateOptions({
        lineNumbers: ((n: number) => String(start + n - 1)) as any,
      });
    });

    // Track cursor position — throttled to avoid re-rendering on every keystroke/arrow
    let cursorThrottleTimer: ReturnType<typeof setTimeout> | null = null;
    const updateCursor = () => {
      if (cursorThrottleTimer) return;
      cursorThrottleTimer = setTimeout(() => {
        cursorThrottleTimer = null;
        const pos = editor.getPosition();
        const model = editor.getModel();
        if (!pos || !model) return;
        const lineText = model.getLineContent(pos.lineNumber);
        const charBefore = pos.column > 1 ? lineText[pos.column - 2] : '\u21B5';
        const charAfter = pos.column - 1 < lineText.length ? lineText[pos.column - 1] : '\u21B5';
        setCursorInfo({
          blockId,
          localLine: pos.lineNumber,
          column: pos.column,
          charBefore: charBefore === ' ' ? '\u00B7' : charBefore,
          charAfter: charAfter === ' ' ? '\u00B7' : charAfter,
        });
      }, 200);
    };
    editor.onDidChangeCursorPosition(updateCursor);
    editor.onDidFocusEditorText(updateCursor);
  };

  /**
   * Format proof state as plain text for the tutor.
   */
  const formatProofState = useCallback((pv: typeof coqState.proofView): string => {
    if (!pv?.proof?.goals?.length) return "No proof in progress";
    return pv.proof.goals.map((g, i) => {
      const hyps = g.hypotheses.map(h => ppToString(h)).join("\n  ");
      const goal = ppToString(g.goal);
      return `Goal ${i + 1}/${pv.proof!.goals.length}:\n  ${hyps}\n  ============================\n  ${goal}`;
    }).join("\n\n");
  }, []);

  /**
   * Rebuild the full document by splicing edited block contents
   * into the original document at their correct line positions.
   */
  const rebuildDocument = useCallback((): string => {
    const parts: string[] = [];
    for (const block of blocks) {
      const content = blockContentsRef.current.get(block.id) || block.content;
      parts.push(content);
    }
    return parts.join('\n');
  }, [blocks]);

  /** Recompute starting line (1-indexed) for each block based on current content. */
  const recomputeStartLinesRaw = useCallback(() => {
    const map = new Map<number, number>();
    let currentLine = 1;
    for (const block of blocks) {
      map.set(block.id, currentLine);
      const content = blockContentsRef.current.get(block.id) || block.content;
      const lineCount = content.split('\n').length;
      currentLine += lineCount;
    }
    setBlockStartLines(map);
  }, [blocks]);

  // Throttled version for keystroke path — coalesces rapid edits into one update
  const recomputeThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recomputeStartLines = useCallback(() => {
    if (recomputeThrottleRef.current) return;
    recomputeThrottleRef.current = setTimeout(() => {
      recomputeThrottleRef.current = null;
      recomputeStartLinesRaw();
    }, 150);
  }, [recomputeStartLinesRaw]);

  // Initial compute when blocks load (immediate, not throttled)
  useEffect(() => {
    if (blocks.length > 0) recomputeStartLinesRaw();
  }, [blocks, recomputeStartLinesRaw]);

  // Update Monaco line-number functions — ONLY for editors whose start line changed.
  // Calling updateOptions on the focused editor causes cursor position disturbance.
  const prevStartLinesRef = useRef<Map<number, number>>(new Map());
  useEffect(() => {
    const prev = prevStartLinesRef.current;
    editorInstancesRef.current.forEach((editor, blockId) => {
      const start = blockStartLines.get(blockId) || 1;
      const oldStart = prev.get(blockId) || 0;
      if (start !== oldStart) {
        // Skip updating the editor that currently has text focus — avoids cursor jump
        if (!editor.hasTextFocus()) {
          editor.updateOptions({
            lineNumbers: ((n: number) => String(start + n - 1)) as any,
          });
        }
      }
    });
    prevStartLinesRef.current = new Map(blockStartLines);
  }, [blockStartLines]);

  /** Sync document if dirty, then run action.
   * Only sends didChange when user explicitly steps — never auto during typing.
   * No artificial delays — vscoqtop processes messages in order. */
  const syncThenDo = useCallback((action: () => void) => {
    if (debounceTimerRef.current) {
      // Document is dirty — sync it before stepping
      if (typeof debounceTimerRef.current === 'number') {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = null;
      const newDoc = rebuildDocument();
      coqActions.sendChange(newDoc);
      originalDocRef.current = newDoc;
    }
    // Step immediately — vscoqtop processes didChange before stepForward
    // because they arrive in order on the same WebSocket
    action();
  }, [rebuildDocument, coqActions]);

  // Keep refs in sync — use assignment during render (not useEffect) for immediate availability
  blockStartLinesRef.current = blockStartLines;
  coqActionsRef.current = coqActions;
  syncThenDoRef.current = syncThenDo;
  const highlightsRef = useRef(coqState.highlights);
  highlightsRef.current = coqState.highlights;

  // Save the rebuilt document, auto-grade, and show results
  const handleSave = useCallback(async () => {
    if (!volumeId || !chapterName) return;
    setSaving(true);
    try {
      const doc = rebuildDocument();
      const result = await saveChapterFile(volumeId, chapterName, doc);
      originalDocRef.current = doc;
      setSaveResult(result);
      // Refresh exercises to update status badges
      getExercises(volumeId, chapterName).then(setExercises).catch(console.error);
      // Clear save result notification after 5 seconds
      setTimeout(() => setSaveResult(null), 5000);
    } catch (e: any) {
      console.error('Save failed:', e);
    } finally {
      setSaving(false);
    }
  }, [volumeId, chapterName, rebuildDocument]);

  // Reset to original code
  const handleReset = useCallback(async () => {
    if (!volumeId || !chapterName) return;
    if (!confirm('Reset this chapter to its original code? Your changes will be lost.')) return;
    try {
      await resetChapterFile(volumeId, chapterName);
      // Reload the page to get fresh blocks
      window.location.reload();
    } catch (e: any) {
      console.error('Reset failed:', e);
    }
  }, [volumeId, chapterName]);

  const scrollToBlock = (blockId: number) => {
    blockRefsMap.current.get(blockId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActiveBlockId(blockId);
  };

  // Run to end of a specific block
  const runToBlock = useCallback((blockId: number) => {
    const block = blocks.find(b => b.id === blockId);
    if (!block) return;
    const label = block.title || block.exercise_name || `block ${blockId}`;
    editHistoryRef.current.push({
      blockId, timestamp: Date.now(), action: 'run',
      description: `Clicked 'run' on "${label}"`,
    });
    if (editHistoryRef.current.length > 100) editHistoryRef.current.shift();
    setActivityVersion(v => v + 1);

    // Find the PREVIOUS block's end to use as start — run only THIS block
    const blockIdx = blocks.findIndex(b => b.id === blockId);
    // Find the next block's start line (dynamic) — that's where this block ends
    let endLine: number;
    if (blockIdx + 1 < blocks.length) {
      const nextBlockStart = blockStartLines.get(blocks[blockIdx + 1].id) || blocks[blockIdx + 1].line_start;
      endLine = nextBlockStart - 2; // -1 for 0-indexed, -1 for the gap between blocks
    } else {
      // Last block — use current content to compute end
      const content = blockContentsRef.current.get(blockId) || block.content;
      const startLine = blockStartLines.get(blockId) || block.line_start;
      endLine = startLine + content.split('\n').length - 2; // 0-indexed
    }

    coqActions.interpretToPoint(Math.max(0, endLine), 9999);
  }, [blocks, coqActions, blockStartLines]);

  // Determine if a block has any processed range
  const isBlockProcessed = useCallback((blockId: number): 'none' | 'partial' | 'full' => {
    // If block was edited and not yet re-processed, show as unprocessed
    if (dirtyBlockIds.has(blockId)) return 'none';

    if (!coqState.highlights) return 'none';
    const block = blocks.find(b => b.id === blockId);
    if (!block) return 'none';

    const blockStart = block.line_start - 1;
    const blockEnd = (block.line_end || block.line_start) - 1;

    const processed = coqState.highlights.processedRange || [];
    for (const r of processed) {
      if (r.end.line >= blockEnd && r.start.line <= blockStart) return 'full';
      if (r.end.line >= blockStart && r.start.line <= blockEnd) return 'partial';
    }
    return 'none';
  }, [coqState.highlights, blocks, dirtyBlockIds]);

  // Context panel: extract names from the processed portion of the document
  const allExecutedTexts = useMemo(() => {
    if (!coqState.highlights) return [];
    const processed = coqState.highlights.processedRange || [];
    if (processed.length === 0) return [];
    const maxLine = Math.max(...processed.map(r => r.end.line));
    const fullText = blocks.map(b => blockContentsRef.current.get(b.id) || b.content).join('\n\n');
    const lines = fullText.split('\n');
    const executedText = lines.slice(0, maxLine + 1).join('\n');
    // Split on periods to get sentences
    return executedText.split(/\.(?=\s|$)/).map(s => s.trim() + '.').filter(s => s.length > 2);
  }, [coqState.highlights, blocks]);

  useEffect(() => {
    const entries = parseContextEntries(allExecutedTexts);
    setCompletionContext(getContextNames(entries));
  }, [allExecutedTexts]);

  // Disabled: never programmatically move the cursor.
  // The user controls their cursor position — vscoqtop's moveCursor
  // notifications are ignored to prevent cursor jumping between blocks.
  // The green highlight shows what's been processed instead.

  // IntersectionObserver — detect which block is currently in the viewport
  useEffect(() => {
    if (!blocks.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        // Find the block closest to the center of the viewport
        const visible = entries
          .filter(e => e.isIntersecting)
          .map(e => ({ id: Number((e.target as HTMLElement).dataset.blockId), ratio: e.intersectionRatio }))
          .sort((a, b) => b.ratio - a.ratio);
        if (visible.length > 0 && !Number.isNaN(visible[0].id)) {
          setViewedBlockId(visible[0].id);
        }
      },
      { root: null, rootMargin: '-30% 0px -30% 0px', threshold: [0, 0.25, 0.5, 0.75, 1] }
    );

    blockRefsMap.current.forEach((el, blockId) => {
      el.dataset.blockId = String(blockId);
      observer.observe(el);
    });

    return () => observer.disconnect();
  }, [blocks]);

  // Inject CSS
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      .coq-processed { background-color: rgba(34, 197, 94, 0.10) !important; }
      .coq-processing { background-color: rgba(59, 130, 246, 0.08) !important; }
    `;
    document.head.appendChild(style);
    return () => { document.head.removeChild(style); };
  }, []);

  // Build user activity context (what the user is doing right now)
  const getActivityContext = useCallback((): string => {
    const parts: string[] = [];

    // Helper that returns a label with CURRENT dynamic line (not stale b.line_start)
    const labelWithLine = (b: BlockData): string => {
      const start = blockStartLines.get(b.id) || b.line_start;
      const name = b.title || b.exercise_name || `${b.kind}`;
      return `${name} (starts at line ${start})`;
    };

    // Currently viewed block (via IntersectionObserver — updates on scroll)
    if (viewedBlockId !== null) {
      const b = blocks.find(bl => bl.id === viewedBlockId);
      if (b) {
        parts.push(`Currently VIEWING (scroll position): block ${b.id} — ${labelWithLine(b)}`);
      }
    }

    // Cursor — use authoritative cursorInfo (not stale activeBlockId)
    if (cursorInfo) {
      const b = blocks.find(bl => bl.id === cursorInfo.blockId);
      if (b) {
        const blockStart = blockStartLines.get(b.id) || b.line_start;
        const absLine = blockStart + cursorInfo.localLine - 1;
        parts.push(
          `Cursor is in: block ${b.id} — ${labelWithLine(b)}\n` +
          `Cursor position: line ${absLine}, column ${cursorInfo.column} ` +
          `(after '${cursorInfo.charBefore}', before '${cursorInfo.charAfter}')`
        );
      }
    }

    // Recent activity — send last 12 events with full descriptions
    const history = editHistoryRef.current.slice(-12);
    if (history.length > 0) {
      const now = Date.now();
      const recentEntries: string[] = [];
      for (let i = history.length - 1; i >= 0; i--) {
        const h = history[i];
        const secondsAgo = Math.round((now - h.timestamp) / 1000);
        const timeStr = secondsAgo < 60 ? `${secondsAgo}s ago` : `${Math.round(secondsAgo / 60)}m ago`;
        recentEntries.push(`  - [${h.action}] ${h.description} (${timeStr})`);
      }
      parts.push('Recent activity (most recent first):\n' + recentEntries.join('\n'));
    }

    return parts.join('\n');
  }, [viewedBlockId, cursorInfo, blocks, blockStartLines]);

  // Build GPS anchors for tutor cross-referencing
  const gpsAnchors = useMemo((): GpsAnchor[] => {
    const anchors: GpsAnchor[] = [];
    for (const b of blocks) {
      if (b.kind === 'section_header' && b.title)
        anchors.push({ label: b.title, blockId: b.id, kind: 'section' });
      else if (b.kind === 'subsection_header' && b.title)
        anchors.push({ label: b.title, blockId: b.id, kind: 'subsection' });
      else if (b.kind === 'exercise' && b.exercise_name)
        anchors.push({ label: `Exercise: ${b.exercise_name}`, blockId: b.id, kind: 'exercise' });
      else if (b.kind === 'code') {
        // Extract Definition/Theorem/Lemma names
        const match = b.content.match(/^(Definition|Fixpoint|Theorem|Lemma|Example|Inductive)\s+(\w+)/m);
        if (match) anchors.push({ label: `${match[1]} ${match[2]}`, blockId: b.id, kind: 'definition' });
      }
    }
    return anchors;
  }, [blocks]);

  // Navigate to a block (used by GPS links in tutor responses)
  const navigateToBlock = useCallback((blockId: number) => {
    const el = blockRefsMap.current.get(blockId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el.style.outline = '3px solid #3b82f6';
      el.style.outlineOffset = '4px';
      el.style.borderRadius = '8px';
      setTimeout(() => { el.style.outline = ''; el.style.outlineOffset = ''; }, 2000);
    }
    setActiveBlockId(blockId);
    editHistoryRef.current.push({
      blockId, timestamp: Date.now(), action: 'navigate',
      description: `Jumped via TOC/link to block ${blockId}`,
    });
    if (editHistoryRef.current.length > 100) editHistoryRef.current.shift();
    setActivityVersion(v => v + 1);
  }, []);

  // Clear stale explanation when proof state changes
  useEffect(() => {
    setExplanation(null);
  }, [coqState.proofView, coqState.diagnostics]);

  // Manual explain — user clicks button to fetch explanation
  const handleExplain = useCallback(async () => {
    if (!volumeId || !chapterName || explainLoading) return;
    setExplainLoading(true);
    try {
      const activeEx = blocks.find(b => b.id === activeBlockId && b.kind === 'exercise');
      const activityCtx = getActivityContext();
      const proofText = formatProofState(coqState.proofView);
      const diagText = coqState.diagnostics.map(d =>
        `Line ${d.range.start.line + 1}: ${d.message}`
      ).join('\n');
      const processed = coqState.highlights?.processedRange?.length
        ? Math.max(...coqState.highlights.processedRange.map(r => r.end.line))
        : null;

      // Build the current block content so AI can see exactly what was edited
      let currentBlockContent = '';
      const curBlock = cursorInfo ? blocks.find(b => b.id === cursorInfo.blockId) : null;
      if (curBlock) {
        const content = blockContentsRef.current.get(curBlock.id) || curBlock.content;
        const startLine = blockStartLines.get(curBlock.id) || curBlock.line_start;
        currentBlockContent = `\n## CURRENT BLOCK (where cursor is, starting at line ${startLine}):\n\`\`\`coq\n${content}\n\`\`\``;
      }

      const message = `## USER ACTIVITY\n${activityCtx || 'No activity tracked yet'}${currentBlockContent}\n\n` +
        `IMPORTANT INSTRUCTIONS:\n` +
        `1. Look at the "Recent activity" section carefully — if the user recently DELETED or ADDED characters, ` +
        `that edit is almost certainly the CAUSE of any current error. Tell the user what their edit broke.\n` +
        `2. Look at "CURRENT BLOCK" — this is the actual code the user is looking at RIGHT NOW. ` +
        `If there's an error, explain it in terms of this block's content.\n` +
        `3. If the user deleted a period (.), explain that Coq requires periods to terminate commands.\n\n` +
        `Now explain the current Coq output. Be concise — a few short paragraphs. Use markdown.`;

      const result = await explainOutput({
        volume_id: volumeId,
        chapter_name: chapterName,
        exercise_name: activeEx?.exercise_name || null,
        student_code: rebuildDocument(),
        proof_state_text: proofText,
        diagnostics_text: diagText,
        processed_lines: processed,
        message,
      });
      setExplanation(result.explanation);
    } catch (e: any) {
      setExplanation(`Error: ${e.message}`);
    } finally {
      setExplainLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [volumeId, chapterName, blocks, activeBlockId, cursorInfo, viewedBlockId, blockStartLines, getActivityContext, formatProofState, rebuildDocument, coqState.proofView, coqState.diagnostics, coqState.highlights, explainLoading]);

  // Drag handler for the tutor chatbox header
  const onDragStart = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    const box = tutorBoxRef.current;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    const offX = e.clientX - rect.left;
    const offY = e.clientY - rect.top;
    // Switch from bottom/right positioning to top/left for dragging
    box.style.right = 'auto';
    box.style.bottom = 'auto';
    box.style.left = rect.left + 'px';
    box.style.top = rect.top + 'px';
    const onMove = (ev: MouseEvent) => {
      box.style.left = Math.max(0, ev.clientX - offX) + 'px';
      box.style.top = Math.max(0, ev.clientY - offY) + 'px';
    };
    const onUp = () => { document.removeEventListener('pointermove', onMove); document.removeEventListener('pointerup', onUp); };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }, []);

  // Resize handler for the tutor chatbox bottom-right corner
  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const box = tutorBoxRef.current;
    if (!box) return;
    const startX = e.clientX, startY = e.clientY;
    const startW = box.offsetWidth, startH = box.offsetHeight;
    const onMove = (ev: MouseEvent) => {
      box.style.width = Math.max(340, Math.min(800, startW + (ev.clientX - startX))) + 'px';
      box.style.height = Math.max(280, Math.min(900, startH + (ev.clientY - startY))) + 'px';
    };
    const onUp = () => { document.removeEventListener('pointermove', onMove); document.removeEventListener('pointerup', onUp); };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }, []);

  return (
    <div className="h-screen flex flex-col bg-white" style={{ fontFamily: "'Open Sans', sans-serif" }}>
      {/* Top bar */}
      <div className="h-11 bg-white border-b border-gray-200 flex items-center px-4 gap-3 shrink-0 shadow-sm">
        <Link to={`/volume/${volumeId}`} className="text-sm text-gray-500 hover:text-gray-700">
          &larr; {volumeId?.toUpperCase()}
        </Link>
        <span className="text-sm font-semibold text-gray-800">{chapterName}.v</span>

        <div className="flex items-center gap-2 ml-auto">
          <button onClick={() => { /* cursor movement disabled */ syncThenDo(coqActions.stepBackward); }}
            disabled={!coqState.connected}
            className="px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 disabled:opacity-30 rounded font-medium border border-gray-200"
            title="Step Back (Alt+Up)">
            &#9664; Undo
          </button>
          <button onClick={() => { /* cursor movement disabled */ syncThenDo(coqActions.stepForward); }}
            disabled={!coqState.connected}
            className="px-3 py-1.5 text-xs bg-[#7088a8] hover:bg-[#607898] text-white disabled:opacity-30 rounded font-medium shadow-sm"
            title="Step Forward (Alt+Down)">
            Step &#9654;
          </button>

          <div className="w-px h-5 bg-gray-200" />

          <button onClick={handleSave} disabled={saving}
            className="px-3 py-1.5 text-xs bg-green-600 hover:bg-green-700 text-white disabled:opacity-30 rounded font-medium shadow-sm">
            {saving ? 'Saving...' : 'Save & Grade'}
          </button>
          <button onClick={handleReset}
            className="px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 rounded font-medium border border-gray-200"
            title="Reset to original code">
            Reset
          </button>
          <button onClick={() => setTocOpen(!tocOpen)}
            className="px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 rounded font-medium border border-gray-200">
            {tocOpen ? 'Hide TOC' : 'TOC'}
          </button>

          <span className={`w-2 h-2 rounded-full ${coqState.connected ? 'bg-green-500' : 'bg-gray-300'}`}
                title={coqState.connected ? 'vscoqtop connected' : 'Connecting...'} />
        </div>
      </div>

      {/* Save result notification */}
      {saveResult && (
        <div className={`px-4 py-2 text-sm flex items-center gap-3 ${
          saveResult.completed > 0 ? 'bg-green-50 text-green-800' : 'bg-blue-50 text-blue-800'
        }`}>
          <span className="font-semibold">
            Saved & graded: {saveResult.completed}/{saveResult.total} exercises completed
          </span>
          {saveResult.exercises.filter(e => e.status === 'completed').map(e => (
            <span key={e.name} className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
              {e.name} &#10003;
            </span>
          ))}
          <button onClick={() => setSaveResult(null)} className="ml-auto text-xs opacity-50 hover:opacity-100">&#10005;</button>
        </div>
      )}

      {/* Main: TOC + Blocks + Goals */}
      <div className="flex-1 flex min-h-0">
        {/* TOC */}
        {tocOpen && (
          <>
            <aside
              ref={tocAsideRef}
              className="shrink-0 bg-white border-r border-gray-200 overflow-y-auto"
              style={{ width: tocWidth }}
            >
              <div className="p-3">
                <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">Contents</h3>
                <nav className="space-y-0.5">
                  {toc.map(entry => (
                    <button key={entry.block_id} onClick={() => scrollToBlock(entry.block_id)}
                      className={`block w-full text-left text-xs py-1.5 px-2 rounded truncate transition-colors ${
                        activeBlockId === entry.block_id
                          ? 'bg-blue-50 text-blue-700 font-medium'
                          : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
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
            {/* TOC resize handle — direct DOM manipulation, no React re-renders during drag */}
            <div
              className="w-1 shrink-0 cursor-col-resize bg-transparent hover:bg-blue-300 active:bg-blue-500 transition-colors"
              onMouseDown={(e) => {
                e.preventDefault();
                const startX = e.clientX;
                const startW = tocAsideRef.current?.offsetWidth || tocWidth;
                let latestW = startW;
                const onMove = (ev: MouseEvent) => {
                  latestW = Math.max(140, Math.min(500, startW + (ev.clientX - startX)));
                  if (tocAsideRef.current) tocAsideRef.current.style.width = latestW + 'px';
                };
                const onUp = () => {
                  document.removeEventListener('pointermove', onMove);
                  document.removeEventListener('pointerup', onUp);
                  setTocWidth(latestW); // commit final width to React state
                };
                document.addEventListener('pointermove', onMove);
                document.addEventListener('pointerup', onUp);
              }}
            />
          </>
        )}

        {/* Blocks */}
        <div className="flex-1 overflow-y-auto min-w-0">
          <div className="max-w-4xl mx-auto py-6 px-4 space-y-1">
            {blocks.map(block => {
              const status = isBlockProcessed(block.id);

              return (
                <div key={block.id} ref={el => { if (el) blockRefsMap.current.set(block.id, el); }}>
                  {/* Section header */}
                  {block.kind === 'section_header' && (
                    <div className="sf-section-header">{block.title}</div>
                  )}

                  {/* Subsection header */}
                  {block.kind === 'subsection_header' && (
                    <div className="sf-subsection-header">{block.title}</div>
                  )}

                  {/* Comment */}
                  {block.kind === 'comment' && (
                    <div className="px-1 py-2"><CommentBlock content={block.content} /></div>
                  )}

                  {/* Code block */}
                  {block.kind === 'code' && (
                    <div
                      className={`overflow-hidden my-1 border-l-3 transition-all ${
                        status === 'full' ? 'border-l-green-400' :
                        status === 'partial' ? 'border-l-amber-400' :
                        activeBlockId === block.id ? 'border-l-blue-400' :
                        'border-l-transparent'
                      }`}
                      onClick={() => setActiveBlockId(block.id)}
                    >
                      <div className="flex items-center px-2 py-0">
                        <span className="text-[10px] font-mono text-gray-300" />
                        <div className="ml-auto flex items-center gap-2">
                          {status !== 'full' && (
                            <button onClick={(e) => { e.stopPropagation(); /* cursor movement disabled */ syncThenDo(() => runToBlock(block.id)); }}
                              disabled={!coqState.connected}
                              className="text-[10px] text-blue-500 hover:text-blue-700 disabled:opacity-30 font-medium">
                              &#9654; run
                            </button>
                          )}
                          {status === 'full' && (
                            <span className="text-[10px] text-green-600 font-medium">&#10003;</span>
                          )}
                        </div>
                      </div>
                      <Editor height="auto" language={COQ_LANGUAGE_ID} theme="coqTheme"
                        defaultValue={block.content}
                        beforeMount={handleBeforeMount} onMount={handleEditorMount(block.id)}
                        options={{
                          fontSize: 13, fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                          minimap: { enabled: false },
                          lineNumbers: ((n: number) => String(((blockStartLines.get(block.id) || 1) + n - 1))) as any,
                          wordWrap: 'on',
                          scrollBeyondLastLine: false, tabSize: 2,
                          scrollbar: { vertical: 'hidden', horizontal: 'auto' },
                          overviewRulerLanes: 0, overviewRulerBorder: false,
                          hideCursorInOverviewRuler: true, lineDecorationsWidth: 6,
                          lineNumbersMinChars: 4, glyphMargin: false, folding: false,
                          automaticLayout: true,
                        }}
                      />
                    </div>
                  )}

                  {/* Exercise block */}
                  {block.kind === 'exercise' && (() => {
                    const stars = block.exercise_stars || 0;
                    return (
                      <div
                        className={`rounded border-2 overflow-hidden my-3 transition-all ${
                          status === 'full' ? 'border-green-400' :
                          status === 'partial' ? 'border-amber-400' :
                          activeBlockId === block.id ? 'border-blue-400 ring-1 ring-blue-200/50' :
                          'border-amber-200'
                        }`}
                        onClick={() => setActiveBlockId(block.id)}
                      >
                        <div className={`flex items-center px-4 py-2 ${
                          status === 'full' ? 'bg-green-50' :
                          status === 'partial' ? 'bg-amber-50' : 'bg-amber-50/50'
                        }`}>
                          <span className="text-amber-500 text-sm mr-2">
                            {'★'.repeat(stars)}{'☆'.repeat(Math.max(0, 5 - stars))}
                          </span>
                          <span className="text-sm font-semibold text-gray-800">{block.exercise_name}</span>
                          <span className="text-xs text-gray-500 ml-2">
                            {block.exercise_difficulty}
                            {block.exercise_modifier ? ` · ${block.exercise_modifier}` : ''}
                          </span>
                          {/* Grading status badge */}
                          {(() => {
                            const ex = exercises.find(e => e.name === block.exercise_name);
                            if (!ex) return null;
                            if (ex.status === 'completed') return (
                              <span className="ml-2 text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">Solved</span>
                            );
                            if (ex.status === 'not_started') return (
                              <span className="ml-2 text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Unsolved</span>
                            );
                            return null;
                          })()}
                          <div className="ml-auto flex items-center gap-2">
                            {status !== 'full' && (
                              <button onClick={(e) => { e.stopPropagation(); /* cursor movement disabled */ syncThenDo(() => runToBlock(block.id)); }}
                                disabled={!coqState.connected}
                                className="text-[10px] text-blue-500 hover:text-blue-700 disabled:opacity-30 font-medium">
                                &#9654; run
                              </button>
                            )}
                            {status === 'full' && (
                              <span className="text-xs text-green-600 font-medium">&#10003;</span>
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (visibleSolution?.name === block.exercise_name) {
                                  setVisibleSolution(null);
                                } else if (volumeId && chapterName && block.exercise_name) {
                                  getExerciseSolution(volumeId, chapterName, block.exercise_name)
                                    .then(data => setVisibleSolution({ name: block.exercise_name!, data }))
                                    .catch(() => setVisibleSolution({ name: block.exercise_name!, data: { exercise_name: block.exercise_name!, solution: 'No solution available yet.', explanation: '' } }));
                                }
                              }}
                              className="text-[10px] text-purple-500 hover:text-purple-700 font-medium"
                            >
                              {visibleSolution?.name === block.exercise_name ? 'Hide solution' : 'See solution'}
                            </button>
                          </div>
                        </div>

                        {/* Sample solution panel */}
                        {visibleSolution?.name === block.exercise_name && (
                          <div className="border-t border-purple-200 bg-purple-50/50 px-4 py-3">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-xs font-semibold text-purple-700">Sample Solution</span>
                              {visibleSolution.data.explanation && (
                                <span className="text-[10px] text-purple-500">— {visibleSolution.data.explanation}</span>
                              )}
                            </div>
                            <pre className="text-xs font-mono text-purple-900 bg-white border border-purple-100 rounded p-3 overflow-x-auto whitespace-pre-wrap leading-relaxed">
                              {visibleSolution.data.solution}
                            </pre>
                          </div>
                        )}

                        <Editor height="auto" language={COQ_LANGUAGE_ID} theme="coqTheme"
                          defaultValue={block.content}
                          beforeMount={handleBeforeMount} onMount={handleEditorMount(block.id)}
                          options={{
                            fontSize: 13, fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                            minimap: { enabled: false }, lineNumbers: 'off', wordWrap: 'on',
                            scrollBeyondLastLine: false, tabSize: 2,
                            scrollbar: { vertical: 'hidden', horizontal: 'auto' },
                            overviewRulerLanes: 0, overviewRulerBorder: false,
                            hideCursorInOverviewRuler: true, lineDecorationsWidth: 8,
                            lineNumbersMinChars: 0, glyphMargin: false, folding: false,
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

        {/* Right panel resize handle — direct DOM manipulation */}
        <div
          className="w-1 shrink-0 cursor-col-resize bg-transparent hover:bg-blue-300 active:bg-blue-500 transition-colors"
          onMouseDown={(e) => {
            e.preventDefault();
            const startX = e.clientX;
            const startW = rightPanelRef.current?.offsetWidth || rightWidth;
            let latestW = startW;
            const onMove = (ev: MouseEvent) => {
              latestW = Math.max(260, Math.min(700, startW - (ev.clientX - startX)));
              if (rightPanelRef.current) rightPanelRef.current.style.width = latestW + 'px';
            };
            const onUp = () => {
              document.removeEventListener('pointermove', onMove);
              document.removeEventListener('pointerup', onUp);
              setRightWidth(latestW);
            };
            document.addEventListener('pointermove', onMove);
            document.addEventListener('pointerup', onUp);
          }}
        />

        {/* Right panel */}
        <div
          ref={rightPanelRef}
          className="shrink-0 flex flex-col bg-white border-l border-gray-200"
          style={{ width: rightWidth }}
        >
          <div className="flex border-b border-gray-200 shrink-0">
            {(['goals', 'context', 'tactics', 'history'] as const).map(tab => (
              <button key={tab} onClick={() => setRightTab(tab)}
                className={`flex-1 text-xs py-2.5 font-medium transition-colors ${
                  rightTab === tab
                    ? 'text-blue-700 border-b-2 border-blue-500 bg-blue-50/50'
                    : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50'
                }`}>
                {tab === 'goals' ? 'Goals' : tab === 'context' ? 'Context' : tab === 'tactics' ? 'Tactics' : 'History'}
              </button>
            ))}
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
            {rightTab === 'goals' && (
              <GoalsPanel
                proofView={coqState.proofView}
                diagnostics={coqState.diagnostics}
                loading={!coqState.connected}
                explanation={explanation}
                explainLoading={explainLoading}
                activityInfo={(() => {
                  const labelFor = (bid: number | null) => {
                    if (bid === null) return null;
                    const b = blocks.find(bl => bl.id === bid);
                    if (!b) return null;
                    const startLine = blockStartLines.get(b.id) || b.line_start;
                    return b.title || b.exercise_name || `${b.kind} at line ${startLine}`;
                  };
                  const now = Date.now();
                  const seen = new Set<string>();
                  const recentEdits: Array<{ action: string; label: string; ago: string }> = [];
                  for (let i = editHistoryRef.current.length - 1; i >= 0 && recentEdits.length < 8; i--) {
                    const h = editHistoryRef.current[i];
                    const key = `${h.blockId}:${h.action}`;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    const label = labelFor(h.blockId);
                    if (!label) continue;
                    const s = Math.round((now - h.timestamp) / 1000);
                    recentEdits.push({
                      action: h.action,
                      label,
                      ago: s < 60 ? `${s}s` : `${Math.round(s / 60)}m`,
                    });
                  }
                  // Cursor block comes from cursorInfo (authoritative), not activeBlockId
                  const cursorBlockId = cursorInfo?.blockId ?? null;
                  // Compute absolute line number in the full document
                  let cursorDetail: string | null = null;
                  if (cursorInfo) {
                    const blockStart = blockStartLines.get(cursorInfo.blockId) || 1;
                    const absLine = blockStart + cursorInfo.localLine - 1;
                    cursorDetail = `line ${absLine}, col ${cursorInfo.column} — after '${cursorInfo.charBefore}', before '${cursorInfo.charAfter}'`;
                  }
                  return {
                    viewedLabel: labelFor(viewedBlockId),
                    focusedLabel: labelFor(cursorBlockId),
                    cursorDetail,
                    recentEdits,
                  };
                })()}
                renderMarkdown={(text) => renderTutorMarkdown(text, navigateToBlock, gpsAnchors)}
                onExplain={handleExplain}
              />
            )}
            {rightTab === 'context' && (
              <ContextPanel executedSentences={allExecutedTexts} />
            )}
            {rightTab === 'tactics' && <TacticsPanel />}
            {rightTab === 'history' && (
              <div className="h-full flex flex-col bg-white">
                <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 flex items-center">
                  <div>
                    <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Activity History</h3>
                    <p className="text-[10px] text-gray-400">Session-only &middot; {editHistoryRef.current.length} events</p>
                  </div>
                  <button
                    onClick={() => { editHistoryRef.current = []; setActivityVersion(v => v + 1); }}
                    className="ml-auto text-[10px] text-gray-400 hover:text-gray-600 px-2 py-1"
                  >clear</button>
                </div>
                {/* Activity Tracking — live cursor/view state */}
                <div className="px-3 py-2 border-b border-gray-200">
                  <div className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider mb-1.5">Current Position</div>
                  <div className="space-y-1 text-[11px]">
                    <div className="flex gap-2">
                      <span className="text-gray-500 shrink-0 w-20">Viewing:</span>
                      <span className="text-indigo-800 font-medium truncate">{(() => {
                        if (!viewedBlockId) return '—';
                        const b = blocks.find(bl => bl.id === viewedBlockId);
                        if (!b) return '—';
                        const startLine = blockStartLines.get(b.id) || b.line_start;
                        return b.title || b.exercise_name || `${b.kind} at line ${startLine}`;
                      })()}</span>
                    </div>
                    <div className="flex gap-2">
                      <span className="text-gray-500 shrink-0 w-20">Cursor block:</span>
                      <span className="text-indigo-800 font-medium truncate">{(() => {
                        if (!cursorInfo) return '—';
                        const b = blocks.find(bl => bl.id === cursorInfo.blockId);
                        if (!b) return '—';
                        const startLine = blockStartLines.get(b.id) || b.line_start;
                        return b.title || b.exercise_name || `${b.kind} at line ${startLine}`;
                      })()}</span>
                    </div>
                    {cursorInfo && (
                      <div className="flex gap-2">
                        <span className="text-gray-500 shrink-0 w-20">Cursor pos:</span>
                        <span className="text-indigo-800 font-mono text-[10px] truncate">
                          line {(blockStartLines.get(cursorInfo.blockId) || 1) + cursorInfo.localLine - 1}, col {cursorInfo.column} — after '{cursorInfo.charBefore}', before '{cursorInfo.charAfter}'
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-2">
                  {editHistoryRef.current.length === 0 && (
                    <div className="text-center text-gray-300 text-xs mt-6">
                      No activity yet. Edit, click, scroll, or press Alt+arrow keys.
                    </div>
                  )}
                  {[...editHistoryRef.current].reverse().map((ev, i) => {
                    const secondsAgo = Math.round((Date.now() - ev.timestamp) / 1000);
                    const timeStr = secondsAgo < 60 ? `${secondsAgo}s ago` : secondsAgo < 3600 ? `${Math.round(secondsAgo / 60)}m ago` : `${Math.round(secondsAgo / 3600)}h ago`;
                    const colors: Record<string, string> = {
                      edit: 'bg-blue-50 text-blue-700 border-blue-100',
                      focus: 'bg-gray-50 text-gray-600 border-gray-100',
                      run: 'bg-green-50 text-green-700 border-green-100',
                      step: 'bg-purple-50 text-purple-700 border-purple-100',
                      navigate: 'bg-amber-50 text-amber-700 border-amber-100',
                    };
                    const cls = colors[ev.action] || 'bg-gray-50 text-gray-600 border-gray-100';
                    // Dummy reference to activityVersion so this re-renders on updates
                    void activityVersion;
                    return (
                      <div key={i} className={`mb-1.5 px-2.5 py-1.5 rounded border text-[11px] ${cls}`}>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold uppercase text-[9px] tracking-wider opacity-70">{ev.action}</span>
                          <span className="ml-auto text-[9px] opacity-60">{timeStr}</span>
                        </div>
                        <div className="mt-0.5 leading-snug">{ev.description}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Floating Tutor Chatbox */}
      {volumeId && chapterName && (
        <>
          {/* Toggle button — always visible, fixed bottom-right */}
          <button
            onClick={() => setTutorOpen(!tutorOpen)}
            className={`fixed bottom-6 right-6 w-14 h-14 rounded-full shadow-lg flex items-center justify-center text-white text-xl z-50 transition-all ${
              tutorOpen ? 'bg-gray-400 hover:bg-gray-500 rotate-45' : 'bg-blue-500 hover:bg-blue-600'
            }`}
            title={tutorOpen ? 'Close tutor' : 'Ask AI tutor'}
          >
            {tutorOpen ? '+' : '?'}
          </button>

          {/* Chat panel — drag header to move, drag corner to resize */}
          {tutorOpen && (
            <div
              ref={tutorBoxRef}
              className="fixed bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col z-40"
              style={{ right: 24, bottom: 96, width: 440, height: 540 }}
            >
              {/* Header — drag to move */}
              <div
                className="flex items-center px-4 py-3 border-b border-gray-100 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-t-2xl cursor-grab active:cursor-grabbing shrink-0 select-none"
                onMouseDown={onDragStart}
              >
                <span className="text-sm font-semibold">AI Tutor</span>
                <span className="text-xs ml-2 opacity-70">GPT-5.4</span>
                <button onClick={() => setTutorOpen(false)}
                  className="ml-auto text-white/70 hover:text-white text-lg leading-none">&times;</button>
              </div>

              {/* Chat body */}
              <div className="flex-1 min-h-0 overflow-hidden">
                <TutorChat
                  ref={tutorChatRef}
                  volumeId={volumeId}
                  chapterName={chapterName}
                  exerciseName={(() => {
                    const b = blocks.find(bl => bl.id === activeBlockId && bl.kind === 'exercise');
                    return b?.exercise_name || null;
                  })()}
                  studentCode={rebuildDocument()}
                  proofStateText={formatProofState(coqState.proofView)}
                  diagnosticsText={coqState.diagnostics.map(d =>
                    `Line ${d.range.start.line + 1}: ${d.message}`
                  ).join('\n')}
                  processedLines={(() => {
                    const pr = coqState.highlights?.processedRange;
                    if (!pr?.length) return null;
                    return Math.max(...pr.map(r => r.end.line));
                  })()}
                  hasError={coqState.diagnostics.some(d => d.severity === 1)}
                  hasGoals={!!coqState.proofView?.proof?.goals?.length}
                  gpsAnchors={gpsAnchors}
                  onNavigate={navigateToBlock}
                  getActivityContext={getActivityContext}
                />
              </div>

              {/* Resize handle — bottom-right */}
              <div
                className="absolute bottom-0 right-0 w-7 h-7 cursor-se-resize z-50"
                onMouseDown={onResizeStart}
              >
                <svg viewBox="0 0 14 14" className="w-full h-full p-1 text-gray-300">
                  <line x1="12" y1="4" x2="4" y2="12" stroke="currentColor" strokeWidth="1.5" />
                  <line x1="12" y1="8" x2="8" y2="12" stroke="currentColor" strokeWidth="1.5" />
                  <line x1="12" y1="12" x2="12" y2="12" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
