import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { sendPresenceHeartbeat, type PresenceUser } from '../api/client';
import { type OnMount, type BeforeMount } from '@monaco-editor/react';
import LazyEditor from '../components/LazyEditor';
import GoalsPanel from '../components/GoalsPanel';
import CommentBlock from '../components/CommentBlock';
import ContextPanel, { parseBlockEntries, getContextNames, type ContextEntry } from '../components/ContextPanel';
import { parseSentences } from '../coq/sentenceParser';
import TacticsPanel from '../components/TacticsPanel';
import TutorChat, { type GpsAnchor, type TutorChatHandle, renderMarkdown as renderTutorMarkdown } from '../components/TutorChat';
import { ppToString } from '../components/PpDisplay';
import { registerCoqLanguage, COQ_LANGUAGE_ID, setCompletionContext } from '../components/coqLanguage';
// import { getSectionIcon } from '../components/SectionIcons';
import {
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
import { useCoqLocal } from '../coq/useCoqLocal';
import type { CoqSessionActions } from '../api/coqWebSocket';
import type { Exercise } from '../types';
import { saveBlockEdits, loadBlockEdits, clearBlockEdits, saveGradeResults, loadGradeResults, type StoredGrade } from '../utils/storage';
import { getPublicAnnotations, createAnnotation as createServerAnnotation, deleteAnnotation as deleteServerAnnotation, type ServerAnnotation } from '../api/client';
import { AnnotationCreatePopover, AnnotationOverlay } from '../components/AnnotationMargin';
import LeaderboardWidget from '../components/LeaderboardWidget';
import SolutionsModal from '../components/SolutionsModal';

export default function ChapterPage() {
  const { volumeId, chapterName } = useParams<{ volumeId: string; chapterName: string }>();
  const [blocks, setBlocks] = useState<BlockData[]>([]);
  const [toc, setToc] = useState<TocEntry[]>([]);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<SaveResult | null>(null);
  const [visibleSolution, setVisibleSolution] = useState<{ name: string; data: SolutionData } | null>(null);
  const [activeBlockId, setActiveBlockId] = useState<number | null>(null);
  const [tocOpen, setTocOpen] = useState(true);
  const [rightTab, setRightTab] = useState<'goals' | 'context' | 'tactics' | 'history' | 'leaders'>('goals');
  const [tocWidth, setTocWidth] = useState(208);   // default 13rem (w-52)
  const [rightWidth, setRightWidth] = useState(384); // default 24rem (w-96)
  const tocAsideRef = useRef<HTMLElement>(null);
  const rightPanelRef = useRef<HTMLDivElement>(null);
  const [tutorOpen, setTutorOpen] = useState(false);
  const tutorBoxRef = useRef<HTMLDivElement>(null);
  const tutorChatRef = useRef<TutorChatHandle>(null);
  const [celebration, setCelebration] = useState<{ names: string[] } | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [serverAnnotations, setServerAnnotations] = useState<ServerAnnotation[]>([]);
  const [solutionsModal, setSolutionsModal] = useState<{ exerciseId: number; exerciseName: string; currentCode: string; blockId: number } | null>(null);

  // Timer
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  const blockContentsRef = useRef<Map<number, string>>(new Map());
  const blockRefsMap = useRef<Map<number, HTMLDivElement>>(new Map());
  const editorInstancesRef = useRef<Map<number, any>>(new Map());
  const monacoRef = useRef<any>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  // Inline explanation / hint state
  const [explanation, setExplanation] = useState<string | null>(null);
  const [explainLoading, setExplainLoading] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [hintLoading, setHintLoading] = useState(false);
  const [dirtyBlockIds, setDirtyBlockIds] = useState<Set<number>>(new Set()); // Blocks edited since last sync
  // Map of block.id -> starting line number in the rebuilt document (1-indexed)
  const [blockStartLines, setBlockStartLines] = useState<Map<number, number>>(new Map());
  // Refs so editor-command closures see current values
  const blockStartLinesRef = useRef<Map<number, number>>(new Map());
  const coqActionsRef = useRef<CoqSessionActions | null>(null);
  const syncThenDoRef = useRef<((action: () => void) => void) | null>(null);

  // Auth + live presence
  const { user: authUser, requireLogin, logout: authLogout } = useAuth();
  // Local "pending" annotations — highlighted in the document while a save
  // is in flight (or after a retriable failure) so the user can see exactly
  // what range their note applies to.
  const [pendingAnnotations, setPendingAnnotations] = useState<Array<{
    id: string;                // client-side id
    block_id: number;
    selected_text: string;
    color: string;
    note: string;
  }>>([]);

  // Server annotation helpers
  const refreshAnnotations = useCallback(() => {
    if (volumeId && chapterName) {
      getPublicAnnotations(volumeId, chapterName)
        .then(setServerAnnotations)
        .catch(() => {});
    }
  }, [volumeId, chapterName]);

  const handleDeleteAnnotation = useCallback(async (id: number) => {
    await deleteServerAnnotation(id);
    refreshAnnotations();
  }, [refreshAnnotations]);

  // State for annotation create popover
  const [annotationCreate, setAnnotationCreate] = useState<{
    blockId: number;
    selectedText: string;
    startLine: number; startCol: number;
    endLine: number; endCol: number;
    x: number; y: number;
  } | null>(null);
  const [presenceUsers, setPresenceUsers] = useState<PresenceUser[]>([]);

  useEffect(() => {
    if (!volumeId || !chapterName || !authUser) return;
    // Send heartbeat every 15 seconds
    const beat = () => {
      sendPresenceHeartbeat(volumeId, chapterName)
        .then(r => setPresenceUsers(r.users))
        .catch(() => {});
    };
    beat();
    const interval = setInterval(beat, 15000);
    return () => clearInterval(interval);
  }, [volumeId, chapterName, authUser]);

  // In-browser Coq via jsCoq Web Worker (replaces server-side vscoqtop)
  const [coqState, coqActions] = useCoqLocal(volumeId ?? null, chapterName ?? null);

  // Pristine block contents from server (never modified) for per-block Reset
  const originalBlockContentsRef = useRef<Map<number, string>>(new Map());

  // Load blocks, exercises, and restore any saved edits/grades from localStorage
  useEffect(() => {
    if (!volumeId || !chapterName) return;
    getChapterBlocks(volumeId, chapterName).then(data => {
      // Capture pristine originals BEFORE applying saved edits
      data.blocks.forEach(b => originalBlockContentsRef.current.set(b.id, b.content));

      // Restore saved edits from localStorage
      const savedEdits = loadBlockEdits(volumeId, chapterName);
      const blocksWithEdits = savedEdits ? data.blocks.map(b => {
        const saved = savedEdits.get(b.id);
        return saved !== undefined ? { ...b, content: saved } : b;
      }) : data.blocks;

      setBlocks(blocksWithEdits);
      setToc(data.toc);
      blocksWithEdits.forEach(b => blockContentsRef.current.set(b.id, b.content));
      originalDocRef.current = blocksWithEdits.map(b => b.content).join('\n');
    });
    // Load annotations from server
    getPublicAnnotations(volumeId, chapterName)
      .then(setServerAnnotations)
      .catch(() => {});
    // Load exercises, then overlay with locally-stored grades
    getExercises(volumeId, chapterName).then(serverExercises => {
      const localGrades = loadGradeResults(volumeId, chapterName);
      if (localGrades) {
        const merged = serverExercises.map(ex => {
          const local = localGrades[ex.name];
          if (local && local.status === 'completed') {
            return { ...ex, status: 'completed' as const };
          }
          return ex;
        });
        setExercises(merged);
      } else {
        setExercises(serverExercises);
      }
    }).catch(console.error);
  }, [volumeId, chapterName]);

  // Page timer — counts up from when page was opened
  useEffect(() => {
    const interval = setInterval(() => setElapsedSeconds(s => s + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  // Disable Alt+Left (browser back) on this page — too easy to trigger accidentally
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.altKey && e.key === 'ArrowLeft') e.preventDefault();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Once Coq engine + blocks are both ready, sync the canonical document
  useEffect(() => {
    if (!coqState.connected || blocks.length === 0) return;
    // Send the block-concatenated document so Coq engine and frontend agree
    const canonicalDoc = blocks.map(b => blockContentsRef.current.get(b.id) || b.content).join('\n');
    coqActions.sendChange(canonicalDoc);
    originalDocRef.current = canonicalDoc;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coqState.connected, blocks.length > 0]);

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

    // Annotate action — right-click or Ctrl+M
    editor.addAction({
      id: 'annotate-selection',
      label: 'Add Annotation',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyM],
      contextMenuGroupId: '9_cutcopypaste',
      contextMenuOrder: 10,
      run: (ed: any) => {
        const sel = ed.getSelection();
        if (!sel || sel.isEmpty()) return;
        const domNode = ed.getDomNode();
        const rect = domNode?.getBoundingClientRect();
        const selectedText = ed.getModel()?.getValueInRange(sel) || '';
        setAnnotationCreate({
          blockId,
          selectedText: selectedText.trim(),
          startLine: sel.startLineNumber,
          startCol: sel.startColumn,
          endLine: sel.endLineNumber,
          endCol: sel.endColumn,
          x: rect ? rect.left + rect.width / 2 : 400,
          y: rect ? rect.top + 60 : 200,
        });
      },
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

    // Track content changes — minimal work on each keystroke for fast typing
    editor.onDidChangeModelContent((ev: any) => {
      const newContent = editor.getModel()?.getValue() || '';
      blockContentsRef.current.set(blockId, newContent);

      // Record edit in history — lightweight, no React state update
      try {
        const change = ev.changes?.[0];
        if (change) {
          const localLine = change.range?.startLineNumber || 0;
          const absLine = (blockStartLinesRef.current.get(blockId) || 1) + localLine - 1;
          const col = change.range?.startColumn || 0;
          const inserted = change.text || '';
          const removed = change.rangeLength || 0;
          const description = inserted
            ? `Added '${(inserted.length > 15 ? inserted.slice(0, 15) + '\u2026' : inserted).replace(/\n/g, '\u21B5')}' at line ${absLine}, col ${col}`
            : removed > 0
            ? `Deleted ${removed} char${removed > 1 ? 's' : ''} at line ${absLine}, col ${col}`
            : `Edit at line ${absLine}`;
          editHistoryRef.current.push({ blockId, timestamp: Date.now(), action: 'edit', description });
          if (editHistoryRef.current.length > 100) editHistoryRef.current.shift();
        }
      } catch {}
      // NOTE: no setActivityVersion here — History tab reads from ref directly

      // Recompute line numbers — debounced heavily (only matters for display)
      recomputeStartLines();

      // Mark dirty — no immediate React state update if already dirty
      if (!dirtyBlockIds.has(blockId)) {
        setDirtyBlockIds(prev => {
          if (prev.has(blockId)) return prev;
          const next = new Set(prev);
          for (const b of blocks) {
            if (b.id >= blockId && (b.kind === 'code' || b.kind === 'exercise')) next.add(b.id);
          }
          return next;
        });
      }

      // Mark that the document is dirty — do NOT send didChange here.
      // Only send when user explicitly steps (Alt+Down/Up, Run).
      // This prevents vscoqtop from parsing incomplete code mid-typing
      // (e.g., typing a comment like "(*ANum*)" before a tactic).
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = 'dirty' as any;  // non-null sentinel = dirty

      // Persist edits to localStorage (debounced — 1s after last keystroke)
      if (localSaveTimerRef.current) clearTimeout(localSaveTimerRef.current);
      localSaveTimerRef.current = setTimeout(() => {
        if (volumeId && chapterName) {
          saveBlockEdits(volumeId, chapterName, blockContentsRef.current);
        }
      }, 1000);
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
      }, 500);
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
  const rebuildDocument = useCallback((_forCoq = false): string => {
    // Build the document EXACTLY from user content. Do NOT inject anything
    // (no auto Admitted) — what users see must be what gets parsed/graded.
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
    }, 500);
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

  // Monaco decorations for code block annotations (server-synced, per-color underlines)
  useEffect(() => {
    if (!monacoRef.current) return;

    // Inject dynamic CSS for each unique annotation color
    let styleEl = document.getElementById('annotation-colors-style');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'annotation-colors-style';
      document.head.appendChild(styleEl);
    }
    const uniqueColors = [...new Set(serverAnnotations.map(a => a.color || '#f59e0b'))];
    styleEl.textContent = uniqueColors.map(c => {
      const cls = 'ann-color-' + c.replace('#', '');
      return `.${cls} { border-bottom: 2px solid ${c}; background: ${c}15; cursor: pointer; }\n.${cls}:hover { background: ${c}30; }`;
    }).join('\n');

    const annotationDecors = annotationDecorationsRef.current;
    editorInstancesRef.current.forEach((editor, blockId) => {
      const blockAnns = serverAnnotations.filter(a => a.block_id === blockId && a.start_line > 0);
      const decorations = blockAnns.map(a => {
        const colorCls = 'ann-color-' + (a.color || '#f59e0b').replace('#', '');
        return {
          range: new monacoRef.current.Range(a.start_line, a.start_col, a.end_line, a.end_col),
          options: {
            inlineClassName: colorCls,
            hoverMessage: { value: `**${a.display_name || a.username}:** ${a.note}` },
          },
        };
      });
      const oldIds = annotationDecors.get(blockId) || [];
      const newIds = editor.deltaDecorations(oldIds, decorations);
      annotationDecors.set(blockId, newIds);
    });
  }, [serverAnnotations]);

  const annotationDecorationsRef = useRef<Map<number, string[]>>(new Map());

  // Highlight annotated text in prose/comment blocks by finding and wrapping
  // the selected_text string in the DOM with a colored <mark> element.
  useEffect(() => {
    // Clean up previous highlights
    document.querySelectorAll('mark[data-annotation-id]').forEach(el => {
      const parent = el.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(el.textContent || ''), el);
        parent.normalize(); // merge adjacent text nodes
      }
    });

    type HighlightItem = {
      id: string;
      block_id: number;
      selected_text: string;
      color?: string;
      note: string;
      tooltip_prefix: string;
      pending?: boolean;
    };
    const items: HighlightItem[] = [
      ...serverAnnotations
        .filter(a => !!a.selected_text)
        .map(a => ({
          id: String(a.id),
          block_id: a.block_id,
          selected_text: a.selected_text,
          color: a.color || '#f59e0b',
          note: a.note,
          tooltip_prefix: a.display_name || a.username,
        })),
      ...pendingAnnotations.map(a => ({
        id: 'pending-' + a.id,
        block_id: a.block_id,
        selected_text: a.selected_text,
        color: a.color,
        note: a.note,
        tooltip_prefix: 'pending',
        pending: true,
      })),
    ];

    // Apply highlights for annotations that have selected_text
    for (const item of items) {
      if (!item.selected_text) continue;
      const blockEl = blockRefsMap.current.get(item.block_id);
      if (!blockEl) continue;

      // Walk text nodes in this block to find the annotated string
      const walker = document.createTreeWalker(blockEl, NodeFilter.SHOW_TEXT);
      const searchText = item.selected_text;
      let node: Text | null;
      while ((node = walker.nextNode() as Text | null)) {
        const idx = node.textContent?.indexOf(searchText) ?? -1;
        if (idx === -1) continue;

        // Split the text node and wrap the match in a <mark>
        const before = node.splitText(idx);
        before.splitText(searchText.length);
        const mark = document.createElement('mark');
        mark.setAttribute('data-annotation-id', item.id);
        const color = item.color || '#f59e0b';
        mark.style.backgroundColor = color + '20';
        mark.style.borderBottom = `2px solid ${color}`;
        mark.style.padding = '0 1px';
        mark.style.borderRadius = '2px';
        mark.style.cursor = 'pointer';
        if (item.pending) {
          mark.style.opacity = '0.85';
          mark.style.borderBottomStyle = 'dashed';
        }
        mark.title = `${item.tooltip_prefix}: ${item.note}`;
        before.parentNode?.replaceChild(mark, before);
        mark.appendChild(document.createTextNode(searchText));
        // Only highlight the first occurrence
        break;
      }
    }
  }, [serverAnnotations, pendingAnnotations]);

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
      const newDoc = rebuildDocument(true);
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

  // Save the rebuilt document, auto-grade, and show results.
  //
  // When `targetExerciseName` is provided (per-exercise "Submit & Grade"), the
  // server compiles ONLY up to and including that exercise (truncated copy,
  // open Modules/Sections auto-closed) and returns a grade for just that one.
  // Errors in code *after* the target never penalize it.
  const handleSave = useCallback(async (targetExerciseName?: string) => {
    if (!volumeId || !chapterName) return;
    setSaving(true);
    try {
      const doc = rebuildDocument();
      const result = await saveChapterFile(volumeId, chapterName, doc, targetExerciseName);
      originalDocRef.current = doc;
      setSaveResult(result);

      // Persist grades to localStorage + detect new completions for celebration
      if (result.exercises) {
        const grades: Record<string, StoredGrade> = {};
        const existing = loadGradeResults(volumeId, chapterName) || {};
        for (const [k, v] of Object.entries(existing)) grades[k] = v;
        const newlyCompleted: string[] = [];
        for (const ex of result.exercises) {
          if (ex.status === 'completed' && existing[ex.name]?.status !== 'completed') {
            newlyCompleted.push(ex.name);
          }
          grades[ex.name] = { status: ex.status, points: ex.points, gradedAt: Date.now() };
        }
        saveGradeResults(volumeId, chapterName, grades);
        if (newlyCompleted.length > 0) {
          setCelebration({ names: newlyCompleted });
          setTimeout(() => setCelebration(null), 4000);
        }
      }
      // Also persist current edits
      saveBlockEdits(volumeId, chapterName, blockContentsRef.current);

      // Update exercises state from grade results.
      //
      // CRITICAL: when targetExerciseName is set, result.exercises only
      // contains the ONE graded exercise. We must MERGE that update into
      // the existing list rather than replace it — otherwise grading a
      // second exercise wipes the prior "Solved" status (and the Share-
      // solution gate) for everything else in the chapter.
      if (result.exercises && result.exercises.length > 0) {
        const localGrades = loadGradeResults(volumeId, chapterName) || {};
        setExercises(prev => {
          const byName = new Map(prev.map(ex => [ex.name, ex]));
          for (const g of result.exercises) {
            const existing = byName.get(g.name);
            const status = g.status === 'completed' || localGrades[g.name]?.status === 'completed'
              ? 'completed' : g.status;
            byName.set(g.name, {
              id: existing?.id ?? 0,
              name: g.name,
              stars: existing?.stars ?? 0,
              difficulty: existing?.difficulty ?? 'standard',
              modifier: existing?.modifier ?? null,
              is_manual: existing?.is_manual ?? false,
              points: existing?.points ?? g.points,
              line_start: existing?.line_start ?? 0,
              line_end: existing?.line_end ?? null,
              status,
              points_earned: g.status === 'completed' ? g.points : 0,
            } as Exercise);
          }
          // Preserve original ordering from `prev`; new entries (if any)
          // appended at the end.
          const out: Exercise[] = [];
          const seen = new Set<string>();
          for (const ex of prev) {
            const merged = byName.get(ex.name);
            if (merged) { out.push(merged); seen.add(ex.name); }
          }
          for (const [name, ex] of byName) {
            if (!seen.has(name)) out.push(ex);
          }
          return out;
        });
      }
      // Modal stays open until user dismisses it
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
      // Clear localStorage for this chapter
      clearBlockEdits(volumeId, chapterName);
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

  /** Compute the 0-indexed Coq doc line for the START of the block AFTER targetBlockId. */
  const getCoqDocLineAfterBlock = useCallback((targetBlockId: number): number => {
    let coqLine = 0;
    let found = false;
    for (const b of blocks) {
      const content = blockContentsRef.current.get(b.id) || b.content;
      const lineCount = content.split('\n').length;
      if (found) {
        return coqLine; // start of the block after target (0-indexed)
      }
      if (b.id === targetBlockId) {
        found = true;
      }
      coqLine += lineCount;
    }
    return coqLine; // target is last block — return total doc length
  }, [blocks]);

  const runToBlock = useCallback((blockId: number) => {
    const block = blocks.find(b => b.id === blockId);
    if (!block) return;
    editHistoryRef.current.push({
      blockId, timestamp: Date.now(), action: 'run',
      description: `Clicked 'run' on "${block.title || block.exercise_name || `block ${blockId}`}"`,
    });
    if (editHistoryRef.current.length > 100) editHistoryRef.current.shift();
    setActivityVersion(v => v + 1);
    // Interpret to the start of the NEXT block to ensure this entire block is covered
    const targetLine = getCoqDocLineAfterBlock(blockId);
    coqActions.interpretToPoint(Math.max(0, targetLine), 0);
  }, [blocks, coqActions, getCoqDocLineAfterBlock]);

  /** Run all blocks from the beginning up to and including this block */
  const runUntilBlock = useCallback((blockId: number) => {
    const block = blocks.find(b => b.id === blockId);
    if (!block) return;
    editHistoryRef.current.push({
      blockId, timestamp: Date.now(), action: 'run',
      description: `Clicked 'run until' on "${block.title || block.exercise_name || `block ${blockId}`}"`,
    });
    if (editHistoryRef.current.length > 100) editHistoryRef.current.shift();
    setActivityVersion(v => v + 1);
    const targetLine = getCoqDocLineAfterBlock(blockId);
    coqActions.interpretToPoint(Math.max(0, targetLine), 0);
  }, [blocks, coqActions, getCoqDocLineAfterBlock]);

  /** Reset a single block to its original (server-fetched) content. */
  const resetBlock = useCallback((blockId: number) => {
    const original = originalBlockContentsRef.current.get(blockId);
    if (original === undefined || !volumeId || !chapterName) return;
    if (!confirm('Reset this block to its original content? Your edits in this block will be lost.')) return;

    // Update in-memory content
    blockContentsRef.current.set(blockId, original);

    // Update the Monaco editor model if it exists
    const editor = editorInstancesRef.current.get(blockId);
    if (editor) {
      const model = editor.getModel();
      if (model) model.setValue(original);
    }

    // Update the block in state so React re-renders with the original content
    setBlocks(prev => prev.map(b => b.id === blockId ? { ...b, content: original } : b));

    // Persist to localStorage
    saveBlockEdits(volumeId, chapterName, blockContentsRef.current);

    // Mark dirty so the document is re-synced to Coq on next action
    setDirtyBlockIds(prev => {
      const next = new Set(prev);
      next.add(blockId);
      return next;
    });

    editHistoryRef.current.push({
      blockId, timestamp: Date.now(), action: 'edit',
      description: `Reset block "${blocks.find(b => b.id === blockId)?.title || blocks.find(b => b.id === blockId)?.exercise_name || `block ${blockId}`}" to original`,
    });
    if (editHistoryRef.current.length > 100) editHistoryRef.current.shift();
    setActivityVersion(v => v + 1);
  }, [blocks, volumeId, chapterName]);

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

  // Context panel: extract rich entries (kind, name, body, blockId, line)
  // from every block that's been fully processed, so users can expand the
  // body inline and jump to source.
  const contextEntries = useMemo<ContextEntry[]>(() => {
    if (!coqState.highlights) return [];
    const processed = coqState.highlights.processedRange || [];
    if (processed.length === 0) return [];
    const maxLine0 = Math.max(...processed.map(r => r.end.line));

    const result: ContextEntry[] = [];
    for (const block of blocks) {
      if (block.kind === 'comment' || block.kind === 'section_header' || block.kind === 'subsection_header') continue;
      const startLine1 = blockStartLines.get(block.id) || block.line_start;
      const content = blockContentsRef.current.get(block.id) || block.content;
      const endLine1 = startLine1 + content.split('\n').length - 1;
      // Only include blocks whose start is within the processed region
      if (startLine1 - 1 > maxLine0) continue;
      // Truncate the block text at the processed boundary if partial
      let effectiveText = content;
      if (endLine1 - 1 > maxLine0) {
        const keepLines = maxLine0 - (startLine1 - 1) + 1;
        if (keepLines <= 0) continue;
        effectiveText = content.split('\n').slice(0, keepLines).join('\n');
      }
      const blockEntries = parseBlockEntries(
        effectiveText,
        block.id,
        startLine1 - 1,
        parseSentences,
      );
      result.push(...blockEntries);
    }
    return result;
  }, [coqState.highlights, blocks, blockStartLines]);

  useEffect(() => {
    setCompletionContext(getContextNames(contextEntries));
  }, [contextEntries]);

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

  // Find which block contains a 0-indexed absolute line number (used by
  // Activity Log click and Context panel jump-to-source).
  const findBlockAtLine = useCallback((absLine0: number): number | null => {
    const targetLine1 = absLine0 + 1;
    let best: { id: number; start: number } | null = null;
    for (const [id, start] of blockStartLines.entries()) {
      if (start <= targetLine1 && (best === null || start > best.start)) {
        best = { id, start };
      }
    }
    return best?.id ?? null;
  }, [blockStartLines]);

  const jumpToAbsLine = useCallback((absLine0: number) => {
    const bid = findBlockAtLine(absLine0);
    if (bid !== null) navigateToBlock(bid);
  }, [findBlockAtLine, navigateToBlock]);

  // Build the rich session-context payload (definitions in scope + recent Coq
  // output events) for tutor/explain and tutor/hint calls.
  const buildTutorSessionContext = useCallback(() => {
    const ctx = contextEntries.map(e => ({
      kind: e.kind,
      name: e.name,
      signature: e.signature,
      line: e.line,
    }));
    const log = coqState.activityLog.map(e => ({
      severity: e.severity,
      text: e.text,
      sentence_preview: e.sentencePreview,
      line: e.line,
      kind: e.kind,
    }));
    return { context_entries: ctx, activity_log: log };
  }, [contextEntries, coqState.activityLog]);

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
        ...buildTutorSessionContext(),
      });
      setExplanation(result.explanation);
    } catch (e: any) {
      setExplanation(`Error: ${e.message}`);
    } finally {
      setExplainLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [volumeId, chapterName, blocks, activeBlockId, cursorInfo, viewedBlockId, blockStartLines, getActivityContext, formatProofState, rebuildDocument, coqState.proofView, coqState.diagnostics, coqState.highlights, explainLoading]);

  const handleHint = useCallback(async () => {
    if (!volumeId || !chapterName || hintLoading) return;
    setHintLoading(true);
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

      let currentBlockContent = '';
      const curBlock = cursorInfo ? blocks.find(b => b.id === cursorInfo.blockId) : null;
      if (curBlock) {
        const content = blockContentsRef.current.get(curBlock.id) || curBlock.content;
        const startLine = blockStartLines.get(curBlock.id) || curBlock.line_start;
        currentBlockContent = `\n## CURRENT BLOCK (where cursor is, starting at line ${startLine}):\n\`\`\`coq\n${content}\n\`\`\``;
      }

      const message = `## USER ACTIVITY\n${activityCtx || 'No activity tracked yet'}${currentBlockContent}\n\n` +
        `## YOUR ROLE\n` +
        `You are a Socratic tutor for the Software Foundations textbook (Coq/Rocq formal verification). ` +
        `The student is working on chapter "${chapterName}" in volume "${volumeId?.toUpperCase()}".\n\n` +
        `## INSTRUCTIONS — HINT FOR NEXT STEP\n` +
        `Based on the current proof state (goals, hypotheses) and the student's code so far:\n\n` +
        `1. **DO NOT give the solution directly.** Instead, guide the student to discover it.\n` +
        `2. Look at the current goal and hypotheses. Suggest which **tactics** could be useful here, ` +
        `and briefly explain WHY each tactic applies (e.g., "The goal is a conjunction, so \`split\` would break it into two subgoals").\n` +
        `3. If there are **multiple approaches**, describe all of them so the student learns the trade-offs ` +
        `(e.g., "You could use \`induction\` for a structural proof, or \`destruct\` if you only need case analysis").\n` +
        `4. If the goal matches a hypothesis or a known lemma, hint at that connection without spelling it out.\n` +
        `5. If the student seems stuck on an error, explain what went wrong and how to recover.\n` +
        `6. Keep it concise — 2-4 short paragraphs. Use markdown. ` +
        `Mention specific tactic names in backticks.\n\n` +
        `Remember: the goal is to help the student **learn**, not just finish the exercise.`;

      const result = await explainOutput({
        volume_id: volumeId,
        chapter_name: chapterName,
        exercise_name: activeEx?.exercise_name || null,
        student_code: rebuildDocument(),
        proof_state_text: proofText,
        diagnostics_text: diagText,
        processed_lines: processed,
        message,
        ...buildTutorSessionContext(),
      });
      setHint(result.explanation);
    } catch (e: any) {
      setHint(`Error: ${e.message}`);
    } finally {
      setHintLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [volumeId, chapterName, blocks, activeBlockId, cursorInfo, blockStartLines, getActivityContext, formatProofState, rebuildDocument, coqState.proofView, coqState.diagnostics, coqState.highlights, hintLoading]);

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
          <button onClick={() => coqActions.interrupt()}
            disabled={!coqState.connected}
            className="px-2 py-1.5 text-xs bg-red-500 hover:bg-red-600 text-white disabled:opacity-30 rounded font-medium shadow-sm"
            title="Interrupt Coq (stop long-running computation)">
            &#9632; Stop
          </button>

          <div className="w-px h-5 bg-gray-200" />

          <button onClick={() => handleSave()} disabled={saving}
            className="px-3 py-1.5 text-xs bg-green-600 hover:bg-green-700 text-white disabled:opacity-30 rounded font-medium shadow-sm"
            title="Save the file and grade ALL exercises in this chapter">
            {saving ? 'Grading...' : 'Submit & Grade All'}
          </button>
          <button onClick={handleReset}
            className="px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 rounded font-medium border border-gray-200"
            title="Reset to original code">
            Reset
          </button>
          <button onClick={() => {
              // 1. Try Monaco editor selection first
              for (const [blockId, editor] of editorInstancesRef.current.entries()) {
                if (!editor.hasTextFocus()) continue;
                const sel = editor.getSelection();
                if (!sel || sel.isEmpty()) continue;
                const selectedText = editor.getModel()?.getValueInRange(sel) || '';
                if (!selectedText.trim()) continue;
                const domNode = editor.getDomNode();
                const rect = domNode?.getBoundingClientRect();
                setAnnotationCreate({
                  blockId, selectedText: selectedText.trim(),
                  startLine: sel.startLineNumber, startCol: sel.startColumn,
                  endLine: sel.endLineNumber, endCol: sel.endColumn,
                  x: rect ? rect.left + rect.width / 2 : 400,
                  y: rect ? rect.top + 60 : 200,
                });
                return;
              }
              // 2. Try browser text selection (for comments, headers, prose)
              const browserSel = window.getSelection();
              if (browserSel && browserSel.toString().trim()) {
                const selectedText = browserSel.toString().trim();
                const anchor = browserSel.anchorNode;
                const blockEl = (anchor instanceof HTMLElement ? anchor : anchor?.parentElement)
                  ?.closest('[data-block-id]') as HTMLElement | null;
                const blockId = blockEl ? Number(blockEl.getAttribute('data-block-id')) : -1;
                const range = browserSel.getRangeAt(0);
                const rect = range.getBoundingClientRect();
                setAnnotationCreate({
                  blockId, selectedText,
                  startLine: 0, startCol: 0, endLine: 0, endCol: 0,
                  x: rect ? rect.left + rect.width / 2 : 400,
                  y: rect ? rect.bottom + 8 : 200,
                });
                return;
              }
              alert('Select some text first, then click Annotate.');
            }}
            className="px-3 py-1.5 text-xs bg-yellow-100 hover:bg-yellow-200 text-yellow-700 rounded font-medium border border-yellow-300"
            title="Add annotation to selected text">
            Annotate
          </button>
          <button onClick={() => setTocOpen(!tocOpen)}
            className="px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 rounded font-medium border border-gray-200">
            {tocOpen ? 'Hide TOC' : 'TOC'}
          </button>
          <button onClick={() => {
              if (document.fullscreenElement) {
                document.exitFullscreen();
              } else {
                document.documentElement.requestFullscreen();
              }
            }}
            className="px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 rounded font-medium border border-gray-200"
            title="Toggle fullscreen (presenting mode)">
            {isFullscreen ? 'Exit Present' : 'Present'}
          </button>

          {/* Live presence avatars */}
          {presenceUsers.length > 0 && (
            <div className="flex items-center -space-x-1.5 mr-2">
              {presenceUsers.slice(0, 8).map(u => (
                <div
                  key={u.user_id}
                  className="w-6 h-6 rounded-full border-2 border-white flex items-center justify-center text-[9px] font-bold text-white cursor-default"
                  style={{ backgroundColor: u.color }}
                  title={`${u.display_name} (@${u.username}) - editing now`}
                >
                  {u.display_name.charAt(0).toUpperCase()}
                </div>
              ))}
              {presenceUsers.length > 8 && (
                <div className="w-6 h-6 rounded-full border-2 border-white bg-gray-400 flex items-center justify-center text-[9px] font-bold text-white">
                  +{presenceUsers.length - 8}
                </div>
              )}
            </div>
          )}
          <div className="flex items-center gap-2 text-[10px] text-gray-400 font-mono">
            <span title="Time on this page">
              {Math.floor(elapsedSeconds / 60)}:{String(elapsedSeconds % 60).padStart(2, '0')}
            </span>
            <span className="text-gray-400">jsCoq</span>
          </div>
          <span className={`w-2 h-2 rounded-full ${coqState.connected ? 'bg-green-500' : 'bg-gray-300'}`}
                title={coqState.connected ? 'Coq ready (in-browser)' : 'Loading Coq engine...'} />
        </div>
      </div>

      {/* Progress bar */}
      {exercises.length > 0 && (() => {
        const done = exercises.filter(e => e.status === 'completed').length;
        const total = exercises.length;
        const pct = Math.round((done / total) * 100);
        return (
          <div className="px-4 py-1.5 bg-gray-50 border-b border-gray-200 flex items-center gap-3 shrink-0">
            <span className="text-xs text-gray-500 font-medium whitespace-nowrap">{done}/{total} solved</span>
            <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700 ease-out"
                style={{
                  width: `${pct}%`,
                  background: pct === 100 ? '#22c55e' : 'linear-gradient(90deg, #7088a8, #60a5fa)',
                }}
              />
            </div>
            <span className="text-xs text-gray-400 font-medium">{pct}%</span>
          </div>
        );
      })()}

      {/* Community solutions modal */}
      {solutionsModal && (
        <SolutionsModal
          exerciseId={solutionsModal.exerciseId}
          exerciseName={solutionsModal.exerciseName}
          currentCode={solutionsModal.currentCode}
          getLatestCode={() => {
            // Read the freshest live block content at click time. Try the
            // Monaco editor instance directly first — it's the source of truth.
            const bid = solutionsModal.blockId;
            const ed = editorInstancesRef.current.get(bid);
            const fromMonaco = ed?.getModel?.()?.getValue?.();
            const fromRef = blockContentsRef.current.get(bid);
            const fallback = blocks.find(b => b.id === bid)?.content ?? '';
            const code = fromMonaco || fromRef || fallback;
            // eslint-disable-next-line no-console
            console.log('[Solutions] getLatestCode', {
              blockId: bid,
              monacoLen: fromMonaco?.length ?? null,
              refLen: fromRef?.length ?? null,
              fallbackLen: fallback.length,
              finalLen: code.length,
            });
            return code;
          }}
          onClose={() => setSolutionsModal(null)}
        />
      )}

      {/* Rocket celebration overlay */}
      {celebration && (
        <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
          {/* Dark overlay */}
          <div className="absolute inset-0 bg-black/20 animate-[fadeIn_0.3s_ease-out]" />
          {/* Rocket */}
          <div className="absolute left-1/2 bottom-0 -translate-x-1/2 animate-[rocketUp_2s_ease-out_forwards]">
            <div className="text-7xl">🚀</div>
            {/* Flame trail */}
            <div className="absolute left-1/2 -translate-x-1/2 top-full flex flex-col items-center gap-0">
              <div className="text-3xl animate-pulse">🔥</div>
              <div className="text-2xl animate-pulse opacity-70">🔥</div>
              <div className="text-xl animate-pulse opacity-40">🔥</div>
            </div>
          </div>
          {/* Sparkles */}
          {Array.from({ length: 20 }).map((_, i) => (
            <div
              key={i}
              className="absolute text-2xl animate-[sparkle_1.5s_ease-out_forwards]"
              style={{
                left: `${15 + Math.random() * 70}%`,
                top: `${20 + Math.random() * 40}%`,
                animationDelay: `${0.3 + Math.random() * 0.8}s`,
                opacity: 0,
              }}
            >
              {['✨', '⭐', '🌟', '💫', '🎉', '🎊'][i % 6]}
            </div>
          ))}
          {/* Congratulations text */}
          <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center animate-[popIn_0.5s_ease-out_0.5s_both]">
            <div className="text-4xl font-bold text-white drop-shadow-lg mb-2">
              Congratulations!
            </div>
            <div className="text-lg text-white/90 drop-shadow">
              {celebration.names.length === 1
                ? `You solved ${celebration.names[0]}!`
                : `You solved ${celebration.names.length} exercises!`}
            </div>
          </div>
        </div>
      )}

      {/* Grading feedback modal */}
      {saveResult && (() => {
        const completed = saveResult.exercises.filter(e => e.status === 'completed');
        const compileErr = saveResult.exercises.filter(e => e.status === 'compile_error');
        const tampered = saveResult.exercises.filter(e => e.status === 'tampered');
        const notStarted = saveResult.exercises.filter(e => e.status === 'not_started');

        const overallTone =
          compileErr.length > 0 ? 'error' :
          tampered.length > 0 ? 'warn' :
          completed.length > 0 ? 'success' : 'info';

        const toneClass = {
          success: 'border-green-400 bg-green-50',
          warn:    'border-amber-400 bg-amber-50',
          error:   'border-red-400 bg-red-50',
          info:    'border-blue-400 bg-blue-50',
        }[overallTone];

        const headerText = {
          success: `\u{1F389} ${completed.length}/${saveResult.total} exercise(s) graded as completed!`,
          warn:    `\u26A0 Tampering detected — ${tampered.length} exercise(s) modified beyond proof body`,
          error:   `\u274C Compile error — your code doesn't compile`,
          info:    `\u{1F4DD} ${notStarted.length} exercise(s) still need work`,
        }[overallTone];

        return (
          <div className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/30 p-4"
               onClick={() => setSaveResult(null)}>
            <div className={`max-w-2xl w-full rounded-xl border-2 ${toneClass} shadow-2xl bg-white max-h-[80vh] overflow-y-auto`}
                 onClick={e => e.stopPropagation()}>
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <h2 className="text-base font-bold text-gray-800">{headerText}</h2>
                <button onClick={() => setSaveResult(null)}
                        className="text-gray-400 hover:text-gray-700 text-xl leading-none">&times;</button>
              </div>

              <div className="px-5 py-4 space-y-3">
                {/* Completed */}
                {completed.map(e => (
                  <div key={e.name} className="border-l-4 border-green-400 bg-green-50/50 px-3 py-2 rounded">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-green-800">{e.name}</span>
                      <span className="text-xs bg-green-200 text-green-800 px-2 py-0.5 rounded-full">+{e.points} pts</span>
                    </div>
                    {e.feedback && <p className="text-xs text-green-700 mt-1">{e.feedback}</p>}
                  </div>
                ))}

                {/* Tampered */}
                {tampered.map(e => (
                  <div key={e.name} className="border-l-4 border-amber-500 bg-amber-50/50 px-3 py-2 rounded">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-amber-800">{e.name}</span>
                      <span className="text-xs bg-amber-200 text-amber-800 px-2 py-0.5 rounded-full">tampered</span>
                    </div>
                    {e.feedback && <p className="text-xs text-amber-700 mt-1">{e.feedback}</p>}
                  </div>
                ))}

                {/* Compile errors */}
                {compileErr.map(e => (
                  <div key={e.name} className="border-l-4 border-red-500 bg-red-50/50 px-3 py-2 rounded">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-red-800">{e.name}</span>
                      <span className="text-xs bg-red-200 text-red-800 px-2 py-0.5 rounded-full">compile error</span>
                    </div>
                    {e.feedback && <p className="text-xs text-red-700 mt-1">{e.feedback}</p>}
                    {e.error_detail && (
                      <pre className="mt-2 text-[10px] font-mono bg-white border border-red-200 rounded p-2 overflow-x-auto whitespace-pre-wrap text-red-900">
{e.error_detail}
                      </pre>
                    )}
                  </div>
                ))}

                {/* Not started */}
                {notStarted.map(e => (
                  <div key={e.name} className="border-l-4 border-gray-400 bg-gray-50 px-3 py-2 rounded">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-gray-700">{e.name}</span>
                      <span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">not started</span>
                    </div>
                    {e.feedback && <p className="text-xs text-gray-600 mt-1">{e.feedback}</p>}
                  </div>
                ))}
              </div>

              <div className="px-5 py-3 border-t border-gray-100 flex justify-end">
                <button onClick={() => setSaveResult(null)}
                        className="px-4 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded font-medium">
                  Close
                </button>
              </div>
            </div>
          </div>
        );
      })()}

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
                  {toc.map(entry => {
                    // Check if this exercise is solved
                    const exBlock = entry.level === 3 ? blocks.find(b => b.id === entry.block_id) : null;
                    const exName = exBlock?.exercise_name;
                    const isSolved = exName ? exercises.some(e => e.name === exName && e.status === 'completed') : false;
                    return (
                    <button key={entry.block_id} onClick={() => scrollToBlock(entry.block_id)}
                      className={`block w-full text-left text-xs py-1.5 px-2 rounded truncate transition-colors ${
                        activeBlockId === entry.block_id
                          ? 'bg-blue-50 text-blue-700 font-medium'
                          : isSolved
                          ? 'text-green-700 hover:bg-green-50'
                          : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                      }`}
                      style={{ paddingLeft: `${entry.level * 10}px` }}
                      title={entry.title}
                    >
                      {entry.level === 3 && (
                        isSolved
                          ? <span className="text-green-500 mr-1">&#10003;</span>
                          : <span className="text-amber-500 mr-1">&#9733;</span>
                      )}
                      {entry.title}
                    </button>
                    );
                  })}
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
        <div className="flex-1 overflow-y-auto min-w-0" id="chapter-scroll-container">
          <div className="relative max-w-4xl mx-auto py-6 px-4 space-y-1">
            {/* Floating annotation margin — absolutely positioned on the right */}
            <AnnotationOverlay
              annotations={serverAnnotations}
              blockRefs={blockRefsMap.current}
              onDelete={handleDeleteAnnotation}
              onRefresh={refreshAnnotations}
            />
            {blocks.map(block => {
              const status = isBlockProcessed(block.id);

              return (
                <div key={block.id} data-block-id={block.id}
                  ref={el => { if (el) blockRefsMap.current.set(block.id, el); }}
                  className="relative"
                >
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

                  {/* Annotations rendered in floating overlay (AnnotationOverlay above) */}

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
                          <button onClick={(e) => { e.stopPropagation(); resetBlock(block.id); }}
                            className="text-[10px] text-gray-400 hover:text-red-500 font-medium"
                            title="Reset this block to its original content">
                            Reset
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); syncThenDo(() => runUntilBlock(block.id)); }}
                            disabled={!coqState.connected}
                            className="text-[10px] text-gray-400 hover:text-blue-600 disabled:opacity-30 font-medium"
                            title="Run all blocks from the beginning up to and including this one">
                            &#9654;&#9654; until
                          </button>
                          {status !== 'full' && (
                            <button onClick={(e) => { e.stopPropagation(); syncThenDo(() => runToBlock(block.id)); }}
                              disabled={!coqState.connected}
                              className="text-[10px] text-blue-500 hover:text-blue-700 disabled:opacity-30 font-medium">
                              &#9654; run {(() => { const s = blockStartLines.get(block.id); if (!s) return ''; const c = blockContentsRef.current.get(block.id) || block.content; return `L${s}-${s + c.split('\n').length - 1}`; })()}
                            </button>
                          )}
                          {status === 'full' && (
                            <span className="text-[10px] text-green-600 font-medium">&#10003;</span>
                          )}
                        </div>
                      </div>
                      <LazyEditor blockId={block.id} language={COQ_LANGUAGE_ID} theme="coqTheme"
                        defaultValue={block.content}
                        beforeMount={handleBeforeMount} onMount={handleEditorMount(block.id)}
                        options={{
                          fontSize: 13, fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                          minimap: { enabled: false },
                          lineNumbers: ((n: number) => String(((blockStartLines.get(block.id) || 1) + n - 1))) as any,
                          wordWrap: 'on',
                          scrollBeyondLastLine: false, tabSize: 2,
                          scrollbar: { vertical: 'hidden', horizontal: 'auto', alwaysConsumeMouseWheel: false },
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
                            <button onClick={(e) => { e.stopPropagation(); resetBlock(block.id); }}
                              className="text-[10px] text-gray-400 hover:text-red-500 font-medium"
                              title="Reset this exercise to its original content">
                              Reset
                            </button>
                            <button onClick={(e) => { e.stopPropagation(); syncThenDo(() => runUntilBlock(block.id)); }}
                              disabled={!coqState.connected}
                              className="text-[10px] text-gray-400 hover:text-blue-600 disabled:opacity-30 font-medium"
                              title="Run all blocks from the beginning up to and including this one">
                              &#9654;&#9654; until
                            </button>
                            {status !== 'full' && (
                              <button onClick={(e) => { e.stopPropagation(); syncThenDo(() => runToBlock(block.id)); }}
                                disabled={!coqState.connected}
                                className="text-[10px] text-blue-500 hover:text-blue-700 disabled:opacity-30 font-medium">
                                &#9654; run {(() => { const s = blockStartLines.get(block.id); if (!s) return ''; const c = blockContentsRef.current.get(block.id) || block.content; return `L${s}-${s + c.split('\n').length - 1}`; })()}
                              </button>
                            )}
                            {status === 'full' && (
                              <span className="text-xs text-green-600 font-medium">&#10003;</span>
                            )}
                            {/* Per-exercise submit button — narrows the feedback modal to just this exercise */}
                            <button
                              onClick={(e) => { e.stopPropagation(); handleSave(block.exercise_name || undefined); }}
                              disabled={saving}
                              className="text-[10px] bg-green-600 hover:bg-green-700 text-white px-2 py-0.5 rounded font-medium disabled:opacity-30"
                              title="Submit and grade only this exercise"
                            >
                              {saving ? 'Grading…' : 'Submit & Grade'}
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (visibleSolution?.name === block.exercise_name) {
                                  setVisibleSolution(null);
                                } else if (volumeId && chapterName && block.exercise_name) {
                                  getExerciseSolution(volumeId, chapterName, block.exercise_name)
                                    .then(data => setVisibleSolution({ name: block.exercise_name!, data }))
                                    .catch(err => {
                                      const msg = String(err).includes('403')
                                        ? 'Solve this exercise first to see the sample solution.'
                                        : 'No solution available yet.';
                                      setVisibleSolution({ name: block.exercise_name!, data: { exercise_name: block.exercise_name!, solution: msg, explanation: '' } });
                                    });
                                }
                              }}
                              className="text-[10px] text-purple-500 hover:text-purple-700 font-medium"
                            >
                              {visibleSolution?.name === block.exercise_name ? 'Hide sample solution' : 'See sample solution'}
                            </button>
                            {/* Community solutions (LeetCode-style) — visible once solved */}
                            {(() => {
                              const ex = exercises.find(e => e.name === block.exercise_name);
                              if (!ex) return null;
                              const solved = ex.status === 'completed';
                              return (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (!solved) return;
                                    // Try three sources, in order of freshness:
                                    //   1. The live Monaco editor instance for this block
                                    //   2. blockContentsRef (updated on every keystroke)
                                    //   3. block.content (the React state, possibly stale)
                                    const ed = editorInstancesRef.current.get(block.id);
                                    const fromMonaco = ed?.getModel?.()?.getValue?.();
                                    const fromRef = blockContentsRef.current.get(block.id);
                                    const code = fromMonaco || fromRef || block.content || '';
                                    // eslint-disable-next-line no-console
                                    console.log('[Solutions] open modal', {
                                      exerciseName: block.exercise_name,
                                      blockId: block.id,
                                      monacoLen: fromMonaco?.length ?? null,
                                      refLen: fromRef?.length ?? null,
                                      blockContentLen: block.content?.length ?? null,
                                      finalLen: code.length,
                                      preview: code.slice(0, 200),
                                    });
                                    setSolutionsModal({
                                      exerciseId: ex.id,
                                      exerciseName: block.exercise_name!,
                                      currentCode: code,
                                      blockId: block.id,
                                    });
                                  }}
                                  disabled={!solved}
                                  title={solved ? 'Browse shared community solutions and discuss' : 'Solve this exercise to unlock shared solutions'}
                                  className={`text-[10px] font-medium px-2 py-0.5 rounded flex items-center gap-1 ${
                                    solved
                                      ? 'text-white bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600'
                                      : 'text-gray-400 bg-gray-100 cursor-not-allowed'
                                  }`}
                                >
                                  {solved ? '\u{1F4AC} See shared solutions' : '\u{1F512} See shared solutions'}
                                </button>
                              );
                            })()}
                          </div>
                        </div>

                        {/* Sample solution panel */}
                        {visibleSolution?.name === block.exercise_name && (
                          <div className="border-t border-purple-200 bg-purple-50/50 px-4 py-3">
                            <div className="mb-2">
                              <span className="text-xs font-semibold text-purple-700">Sample Solution</span>
                              {visibleSolution.data.explanation && (
                                <span className="text-[10px] text-purple-500 ml-1">— {visibleSolution.data.explanation}</span>
                              )}
                            </div>
                            <pre className="text-xs font-mono text-purple-900 bg-white border border-purple-100 rounded p-3 overflow-x-auto whitespace-pre-wrap leading-relaxed">
                              {visibleSolution.data.solution}
                            </pre>
                          </div>
                        )}

                        <LazyEditor blockId={block.id} language={COQ_LANGUAGE_ID} theme="coqTheme"
                          defaultValue={block.content}
                          beforeMount={handleBeforeMount} onMount={handleEditorMount(block.id)}
                          options={{
                            fontSize: 13, fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                            minimap: { enabled: false }, lineNumbers: 'off', wordWrap: 'on',
                            scrollBeyondLastLine: false, tabSize: 2,
                            scrollbar: { vertical: 'hidden', horizontal: 'auto', alwaysConsumeMouseWheel: false },
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
          data-panel="right"
          className="shrink-0 flex flex-col bg-white border-l border-gray-200"
          style={{ width: rightWidth }}
        >
          <div className="flex border-b border-gray-200 shrink-0">
            {(['goals', 'context', 'tactics', 'history', 'leaders'] as const).map(tab => (
              <button key={tab} onClick={() => setRightTab(tab)}
                className={`flex-1 text-xs py-2.5 font-medium transition-colors ${
                  rightTab === tab
                    ? 'text-blue-700 border-b-2 border-blue-500 bg-blue-50/50'
                    : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50'
                }`}>
                {tab === 'goals' ? 'Goals' : tab === 'context' ? 'Context' : tab === 'tactics' ? 'Tactics' : tab === 'history' ? 'History' : '🏆 Leaders'}
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
                hint={hint}
                hintLoading={hintLoading}
                activityLog={coqState.activityLog}
                renderMarkdown={(text) => renderTutorMarkdown(text, navigateToBlock, gpsAnchors)}
                onExplain={handleExplain}
                onHint={handleHint}
                onJumpToLine={jumpToAbsLine}
              />
            )}
            {rightTab === 'context' && (
              <ContextPanel
                entries={contextEntries}
                onJumpTo={(blockId, _line) => navigateToBlock(blockId)}
              />
            )}
            {rightTab === 'tactics' && <TacticsPanel />}
            {rightTab === 'leaders' && volumeId && chapterName && (
              <div className="h-full overflow-y-auto p-3 space-y-3 bg-gray-50">
                <LeaderboardWidget
                  scope="chapter"
                  volumeId={volumeId}
                  chapterName={chapterName}
                  title={`Top in ${chapterName}`}
                  limit={10}
                />
                <LeaderboardWidget
                  scope="volume"
                  volumeId={volumeId}
                  title={`Top in ${volumeId.toUpperCase()}`}
                  limit={10}
                />
                <LeaderboardWidget
                  scope="global"
                  title="Global Top"
                  limit={10}
                />
              </div>
            )}
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
      {/* Annotation create popover — server-synced */}
      {annotationCreate && volumeId && chapterName && (
        <AnnotationCreatePopover
          selectedText={annotationCreate.selectedText}
          position={{ x: annotationCreate.x, y: annotationCreate.y }}
          onSave={async (note, color, isPublic) => {
            const pendingId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            // Add a pending highlight immediately so the selected range stays
            // visible on the page while we talk to the server (and after any
            // retries). Only removed on explicit success, or if the user
            // cancels the re-login prompt on a failed save.
            setPendingAnnotations(p => [...p, {
              id: pendingId,
              block_id: annotationCreate.blockId,
              selected_text: annotationCreate.selectedText,
              color,
              note,
            }]);

            const save = () =>
              createServerAnnotation({
                volume_id: volumeId,
                chapter_name: chapterName,
                block_id: annotationCreate.blockId,
                selected_text: annotationCreate.selectedText,
                note,
                color,
                start_line: annotationCreate.startLine,
                start_col: annotationCreate.startCol,
                end_line: annotationCreate.endLine,
                end_col: annotationCreate.endCol,
                is_public: isPublic,
              });

            const isAuthError = (err: unknown) => {
              const msg = err instanceof Error ? err.message : String(err);
              return /^401/.test(msg) || /Invalid token/i.test(msg) || /Not authenticated/i.test(msg);
            };

            let savedOk = false;
            let fatalError: Error | null = null;
            try {
              await save();
              savedOk = true;
            } catch (err) {
              if (isAuthError(err)) {
                // The cached token is stale (e.g., the user it refers to was
                // deleted). Clear the auth state so `requireLogin` actually
                // pops the modal instead of resolving against the stale user.
                authLogout();
                try {
                  await requireLogin('Please sign in to save annotations.');
                  await save();
                  savedOk = true;
                } catch (inner) {
                  if (inner instanceof Error && inner.message === 'Login cancelled') {
                    // User dismissed the prompt — we'll keep the highlight
                    // on the page so they can see what they tried to annotate.
                  } else {
                    fatalError = inner instanceof Error ? inner : new Error(String(inner));
                  }
                }
              } else {
                fatalError = err instanceof Error ? err : new Error(String(err));
              }
            }

            if (savedOk) {
              refreshAnnotations();
              setPendingAnnotations(p => p.filter(a => a.id !== pendingId));
            } else if (fatalError) {
              // A real error (not just "user cancelled"): show it, drop
              // the pending highlight.
              console.error('Failed to save annotation:', fatalError);
              alert('Failed to save annotation: ' + fatalError.message);
              setPendingAnnotations(p => p.filter(a => a.id !== pendingId));
            }
            // else: user cancelled login → keep the pending highlight
            //   visible as a reminder, with dashed styling.
            setAnnotationCreate(null);
          }}
          onCancel={() => setAnnotationCreate(null)}
        />
      )}

      {/* Keyboard shortcut reminder bar */}
      <div className="h-8 bg-gray-100 border-t border-gray-200 flex items-center justify-center gap-6 shrink-0 text-sm text-gray-500">
        <span><kbd className="px-1.5 py-0.5 bg-white border border-gray-300 rounded text-xs font-mono shadow-sm">Alt+&#8595;</kbd> Step forward</span>
        <span><kbd className="px-1.5 py-0.5 bg-white border border-gray-300 rounded text-xs font-mono shadow-sm">Alt+&#8593;</kbd> Step back</span>
        <span><kbd className="px-1.5 py-0.5 bg-white border border-gray-300 rounded text-xs font-mono shadow-sm">Alt+&#8594;</kbd> Run to cursor</span>
        <span><kbd className="px-1.5 py-0.5 bg-white border border-gray-300 rounded text-xs font-mono shadow-sm">Alt+End</kbd> Run all</span>
        <span className="text-gray-300">|</span>
        <span><kbd className="px-1.5 py-0.5 bg-white border border-gray-300 rounded text-xs font-mono shadow-sm">Ctrl+M</kbd> Annotate selection</span>
        {serverAnnotations.length > 0 && (
          <span className="text-[10px] text-gray-400">{serverAnnotations.length} notes</span>
        )}
      </div>
    </div>
  );
}
