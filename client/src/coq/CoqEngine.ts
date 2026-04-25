/**
 * CoqEngine: Main adapter between jsCoq's sentence-based execution model
 * and our app's document-based interface (matching vscoqtop's behavior).
 *
 * Provides: stepForward, stepBackward, interpretToPoint, interpretToEnd, setDocument
 * Emits: onProofView, onHighlights, onDiagnostics (same types as useCoqWebSocket)
 */

import { CoqWorkerWrapper } from './CoqWorkerWrapper';
import type { CoqObserver, Pp, JsCoqGoals } from './CoqWorkerWrapper';
import { parseSentences, offsetToLineChar } from './sentenceParser';
import type { CoqSentence, LineCharPosition } from './sentenceParser';
import { buildProofView, ppToPpString, ppToText, levelToSeverity } from './ppTranslator';
// Packages are loaded by the worker via LoadPkg (worker fetches + extracts)
import type {
  ProofViewNotification,
  UpdateHighlights,
  CoqDiagnostic,
  HighlightRange,
  RocqMessage,
  ActivityEntry,
} from '../api/coqWebSocket';

/** Volume ID to jsCoq package name mapping.
 *  All volumes load the full Coq standard library since SF chapters freely
 *  import from any part (Arith, Lia, Lists, Strings, ZArith, etc.).
 *  coq-reals includes Coq.micromega (Lia), Coq.Floats, Coq.Reals, Coq.nsatz. */
const COQ_STDLIB = ['init', 'ltac2', 'coq-base', 'coq-collections', 'coq-arith', 'coq-reals'];
const VOLUME_PACKAGES: Record<string, string[]> = {
  lf:   [...COQ_STDLIB, 'sf-LF'],
  plf:  [...COQ_STDLIB, 'sf-PLF'],
  vfa:  [...COQ_STDLIB, 'sf-VFA'],
  slf:  [...COQ_STDLIB, 'sf-SLF'],
  secf: [...COQ_STDLIB],
};

export type SentencePhase =
  | 'pending'      // parsed, not yet sent to worker
  | 'added'        // Add command sent, waiting for Added callback
  | 'executing'    // Exec command sent, waiting for Processed feedback
  | 'processed'    // Successfully processed
  | 'error';       // Error during processing

interface ManagedSentence extends CoqSentence {
  sid: number;
  phase: SentencePhase;
  startPos: LineCharPosition;
  endPos: LineCharPosition;
}

export interface CoqEngineCallbacks {
  onProofView(pv: ProofViewNotification): void;
  onHighlights(hl: UpdateHighlights): void;
  onDiagnostics(diags: CoqDiagnostic[]): void;
  onReady(): void;
  onError(message: string): void;
  onLoadProgress?(ratio: number, pkg: string): void;
  /** Append a new entry to the persistent activity log. */
  onActivityAppend?(entry: ActivityEntry): void;
  /** Trim the activity log: remove any entries whose sid is in the given set. */
  onActivityTrim?(cancelledSids: Set<number>): void;
}

export class CoqEngine implements CoqObserver {
  private worker: CoqWorkerWrapper;
  private callbacks: CoqEngineCallbacks;

  // Document state
  private sentences: ManagedSentence[] = [];
  private nextSid = 2;  // sid 1 is the init state

  // Execution state
  private executionIndex = -1;  // index into sentences[] of last processed sentence (-1 = none)
  private executing = false;    // true while waiting for Add/Exec callbacks
  private pendingAction: (() => void) | null = null;

  // Accumulated state for UI
  private currentGoals: JsCoqGoals | null = null;
  private messages: RocqMessage[] = [];
  private diagnostics: CoqDiagnostic[] = [];

  // Monotonic counter for ActivityEntry.seq
  private activitySeq = 0;
  // Track which sids we've already produced a synthetic "foo is defined" for,
  // to avoid duplicating on replay / multiple feedProcessed for same sid.
  private syntheticFired = new Set<number>();

  // Base path for worker and package assets
  private basePath = '';

  constructor(callbacks: CoqEngineCallbacks) {
    this.callbacks = callbacks;
    this.worker = new CoqWorkerWrapper();
    this.worker.addObserver(this);
  }

  /**
   * Initialize the Coq engine using the WASM backend.
   * Proven working sequence (verified via test-jscoq.html):
   *   1. Create WA worker (JSON-stringified commands)
   *   2. Wait for Boot event
   *   3. LoadPkg directives (raw postMessage) for each package
   *   4. Wait for LoadedPkg events
   *   5. Init with { implicit_libs: true, lib_path: [...all dirs...] }
   *   6. NewDoc with { lib_init: ['Coq.Init.Prelude'] }
   *   7. Receive Ready event → onReady callback
   */
  async init(basePath: string, volumeId: string): Promise<void> {
    this.basePath = basePath.endsWith('/') ? basePath : basePath + '/';
    console.log('[CoqEngine] Initializing WA backend, basePath:', this.basePath);

    // 1. Create WA worker (JSON-stringified messages)
    const workerUrl = this.basePath + 'dist/wacoq_worker.js';
    await this.worker.createWorker(workerUrl, true);

    // 2. Wait for Boot
    await new Promise<void>(resolve => { this._bootResolve = resolve; });
    console.log('[CoqEngine] Boot complete');

    // 3. LoadPkg for each package (raw directive, not JSON-stringified)
    const packages = VOLUME_PACKAGES[volumeId] || VOLUME_PACKAGES.lf;
    const pkgBaseUrl = this.basePath + 'coq-pkgs/';
    for (const pkg of packages) {
      this.worker.sendDirective(['LoadPkg', pkgBaseUrl + pkg + '.coq-pkg']);
    }

    // 4. Wait for all LoadedPkg events
    await new Promise<void>(resolve => {
      let loaded = 0;
      this._pkgResolve = () => {
        loaded++;
        this.callbacks.onLoadProgress?.(loaded / packages.length, '');
        if (loaded >= packages.length) resolve();
      };
    });
    console.log('[CoqEngine] All packages loaded');

    // 5. Init with lib_path covering ALL directories in the loaded packages
    //    Each entry: [[logical_prefix_parts], ['/lib']]
    const lib_path = buildLibPathForPackages(packages);
    console.log('[CoqEngine] Init with', lib_path.length, 'lib_path entries');
    this.worker.init(
      { implicit_libs: true, lib_path },
      { lib_init: ['Coq.Init.Prelude'] }
    );
    // coqReady will fire onReady
  }

  // --- Boot / Package loading callbacks ---
  private _bootResolve: (() => void) | null = null;
  private _pkgResolve: (() => void) | null = null;

  coqBoot(): void {
    this._bootResolve?.();
    this._bootResolve = null;
  }

  coqLoadedPkg(_uris: unknown): void {
    this._pkgResolve?.();
  }

  /**
   * Set or update the full document text.
   * Parses into sentences and diffs against current state.
   */
  setDocument(text: string): void {
    const newSentences = parseSentences(text);

    // Find divergence point — where do old and new sentences differ?
    //
    // IMPORTANT: matching sentence TEXT does not imply matching POSITION.
    // If the user adds blank lines / comments / whitespace around a
    // sentence, its `text` is identical but its byte offsets (and hence
    // line numbers) shift. Previously we kept the stale startPos/endPos,
    // which made the green "processed" highlight drift away from the real
    // sentence as the document grew. Refresh positions from the new text
    // as we walk the matching prefix.
    let divergeIdx = 0;
    while (
      divergeIdx < this.sentences.length &&
      divergeIdx < newSentences.length &&
      this.sentences[divergeIdx].text === newSentences[divergeIdx].text
    ) {
      const fresh = newSentences[divergeIdx];
      const old = this.sentences[divergeIdx];
      old.startOffset = fresh.startOffset;
      old.endOffset = fresh.endOffset;
      old.startPos = offsetToLineChar(text, fresh.startOffset);
      old.endPos = offsetToLineChar(text, fresh.endOffset);
      divergeIdx++;
    }

    // Cancel sentences from divergence point forward
    if (divergeIdx < this.sentences.length) {
      const cancelSid = this.sentences[divergeIdx].sid;
      this.worker.cancel(cancelSid);
      const trimSids = new Set<number>();
      for (let i = divergeIdx; i < this.sentences.length; i++) {
        trimSids.add(this.sentences[i].sid);
        this.syntheticFired.delete(this.sentences[i].sid);
      }
      this.callbacks.onActivityTrim?.(trimSids);
      this.sentences = this.sentences.slice(0, divergeIdx);
      this.executionIndex = Math.min(this.executionIndex, divergeIdx - 1);
      this.executing = false;
      this._executeTarget = -1;
      this._batchExec = false;
      this.pendingAction = null;
    }

    // Add new sentences from divergence point
    for (let i = divergeIdx; i < newSentences.length; i++) {
      const s = newSentences[i];
      const sid = this.nextSid++;
      this.sentences.push({
        ...s,
        sid,
        phase: 'pending',
        startPos: offsetToLineChar(text, s.startOffset),
        endPos: offsetToLineChar(text, s.endOffset),
      });
    }

    // Update highlights
    this.emitHighlights();
  }

  /**
   * Step forward: process the next unprocessed sentence.
   */
  stepForward(): void {
    if (this.executing) {
      this.pendingAction = () => this.stepForward();
      return;
    }
    const nextIdx = this.executionIndex + 1;
    if (nextIdx < this.sentences.length) {
      this.executeSentence(nextIdx);
    }
  }

  /**
   * Step backward: cancel the last processed sentence.
   */
  stepBackward(): void {
    if (this.executing) {
      this.pendingAction = () => this.stepBackward();
      return;
    }
    if (this.executionIndex >= 0) {
      const sentence = this.sentences[this.executionIndex];
      this.worker.cancel(sentence.sid);
      // Mark all from this index forward as pending
      const trimSids = new Set<number>();
      for (let i = this.executionIndex; i < this.sentences.length; i++) {
        this.sentences[i].phase = 'pending';
        trimSids.add(this.sentences[i].sid);
        this.syntheticFired.delete(this.sentences[i].sid);
      }
      this.callbacks.onActivityTrim?.(trimSids);
      this.executionIndex--;
      this.messages = [];
      this.diagnostics = [];

      // Request goals at the new tip
      if (this.executionIndex >= 0) {
        this.worker.goals(this.sentences[this.executionIndex].sid);
      } else {
        this.currentGoals = null;
        this.emitProofView();
      }
      this.emitHighlights();
      this.emitDiagnostics();
    }
  }

  /**
   * Execute to a specific position (0-indexed line/character).
   */
  interpretToPoint(line: number, character: number): void {
    if (this.executing) {
      this.pendingAction = () => this.interpretToPoint(line, character);
      return;
    }

    // Find the target sentence: last sentence whose start is <= (line, character)
    let targetIdx = -1;
    for (let i = 0; i < this.sentences.length; i++) {
      const s = this.sentences[i];
      if (s.startPos.line < line || (s.startPos.line === line && s.startPos.character <= character)) {
        targetIdx = i;
      } else {
        break;
      }
    }

    if (targetIdx > this.executionIndex) {
      // Need to step forward
      this.executeToIndex(targetIdx);
    } else if (targetIdx < this.executionIndex) {
      // Need to step backward
      this.cancelToIndex(targetIdx);
    }
  }

  /**
   * Execute all remaining sentences.
   */
  interpretToEnd(): void {
    if (this.executing) {
      this.pendingAction = () => this.interpretToEnd();
      return;
    }
    if (this.sentences.length > 0) {
      this.executeToIndex(this.sentences.length - 1);
    }
  }

  /**
   * Interrupt current computation.
   */
  interrupt(): void {
    this.worker.interrupt();
  }

  /**
   * Clean up.
   */
  dispose(): void {
    this.worker.terminate();
  }

  // --- Private: Execution Logic ---

  /**
   * Coq 8.17 (bundled in jsCoq 0.17.1) has notation-precedence bugs around
   * SF's `!->` total-map notations, all of which live at level 100 and
   * confuse the parser. We transparently rewrite the sentence text to the
   * unambiguous expanded form before shipping to the worker. All rewrites
   * are semantic no-ops — each is literally how the original notation is
   * defined in Maps.v / Imp.v:
   *
   *   (__ !-> v)             ->  (t_empty v)           [Maps.v:140]
   *   (x  !-> v)             ->  (x !-> v ; empty_st)  [Imp.v two-arg form]
   *
   * Only the bytes shipped to the worker are rewritten — editor text,
   * sentence positions, highlights, and the server grading path
   * (Coq 8.19 via coqc, which handles all of these fine) stay untouched.
   *
   * Remove when/if we upgrade jsCoq to a build using Coq 8.18+.
   */
  private transformForWorker(text: string): string {
    let out = text;

    // 3) Neutralise Imp.v's redeclaration of `x !-> v` at the SAME level-100
    //    as Maps.v's `x !-> v ; m`. Coq 8.17 can't cope with that overlap
    //    and rejects the declaration with a cryptic term-level-200 syntax
    //    error. Since rule (2) below expands every USE of `(x !-> v)` into
    //    the three-arg form anyway, the declaration is redundant in the
    //    jsCoq path — replace it with a harmless no-op Notation.
    //    Regex is permissive about whitespace so it matches even after
    //    the document's been re-formatted.
    out = out.replace(
      /Notation\s+"\s*x\s*'!->'\s*v\s*"\s*:=\s*\(\s*x\s*!->\s*v\s*;\s*empty_st\s*\)\s*\([^)]*\)\s*\./g,
      'Notation "\'__sf_compat_shim\'" := O (at level 0, only parsing).',
    );

    // 1) (__ !-> v) -> (t_empty v)
    out = out.replace(
      /(^|[^A-Za-z0-9_])__(\s+!->\s+)/g,
      (_m, before, sep) => `${before}t_empty${sep.replace(/!->\s+/, '')}`,
    );

    // 2) Terminate any two-arg `!-> <simple_value>)` pattern with `; empty_st`.
    //    This handles BOTH:
    //       (X !-> 5)                  -> (X !-> 5 ; empty_st)
    //       (X !-> 5 ; Y !-> 4)        -> (X !-> 5 ; Y !-> 4 ; empty_st)
    //       (Z !-> 2 ; Y !-> 1 ; X !-> 0)
    //                                  -> (Z !-> 2 ; Y !-> 1 ; X !-> 0 ; empty_st)
    //    The match anchor is `!-> <ident-or-num>\s*)` — i.e. the LAST `!->`
    //    in a chain, immediately followed by `)`. Already-terminated chains
    //    like `(X !-> 5 ; empty_st)` are NOT matched (after the `5` there is
    //    ` ;`, not `)`), so the transform is idempotent.
    out = out.replace(
      /!->(\s+)([A-Za-z_]\w*|\d+)(\s*)\)/g,
      (_m, sp1, val, sp2) => `!->${sp1}${val} ; empty_st${sp2})`,
    );

    // 4) Pad `{{...}}` Hoare-triple braces with whitespace.
    //    Coq 8.17's custom-entry notation parser (used by SF's
    //    `Notation "{{ P }} c {{ Q }}" :=` in Hoare.v with
    //    `c custom com at level 99`) can fail to disambiguate between
    //    the triple `{{P}} c {{Q}}` and the assertion-only `{{P}}` when
    //    the braces hug the content with no whitespace. The notation
    //    declarations themselves use space-padded patterns
    //    (`{{ P }}`, `{{ Q }}`), so insert spaces if missing. Idempotent.
    out = out.replace(/\{\{(?!\s)/g, '{{ ');
    out = out.replace(/(?<!\s)\}\}/g, ' }}');

    return out;
  }

  private executeSentence(idx: number): void {
    const sentence = this.sentences[idx];
    if (!sentence || sentence.phase !== 'pending') return;

    this.executing = true;
    this.messages = [];
    sentence.phase = 'added';

    // tip_sid is the sid of the previously processed sentence, or 1 (init state)
    const tipSid = idx > 0 ? this.sentences[idx - 1].sid : 1;
    this.worker.add(tipSid, sentence.sid, this.transformForWorker(sentence.text));
  }

  /**
   * Execute from `executionIndex+1` up to and including `targetIdx`.
   *
   * Old flow: Add N → coqAdded → Exec N → feedProcessed → Goals(N) →
   * coqGoalInfo → [next]. 3+ round-trips per sentence — too slow.
   *
   * New flow (batch):
   *   - Fire Add sentence-by-sentence, driven by coqAdded callbacks. This
   *     keeps Coq's STM sid-chain valid if any intermediate Add fails
   *     (firing all Adds upfront caused `Stm.Vcs_aux.Expired` when earlier
   *     parse errors invalidated downstream tips).
   *   - Skip the per-sentence Exec/Goals entirely. Fire ONE Exec on the
   *     target sid once all Adds are in. Coq's STM then processes every
   *     dependency in-worker with no main-thread round-trips between them.
   *   - Query Goals only at the final tip.
   *
   * This eliminates 2/3 of the per-sentence round-trips while leaving the
   * incremental Add → coqAdded handshake intact. `feedProcessed` still
   * arrives per-sentence so the green-highlight UI advances smoothly.
   */
  private executeToIndex(targetIdx: number): void {
    if (targetIdx <= this.executionIndex || targetIdx >= this.sentences.length) return;

    this._executeTarget = targetIdx;
    this._batchExec = true;
    this.executing = true;
    this.messages = [];

    // Kick off: Add the first pending sentence. Subsequent Adds are chained
    // from coqAdded (see below), then Exec(target) fires once all are in.
    this._addNextInBatch();
  }
  private _executeTarget = -1;
  /** True while executeToIndex is driving a multi-sentence batch. */
  private _batchExec = false;

  /** Fire the Add for the next pending sentence in the batch window.
   *  When no more pending sentences remain in the window, fire a single
   *  Exec on the target sid. */
  private _addNextInBatch(): void {
    if (!this._batchExec) return;
    const target = this._executeTarget;
    let nextIdx = -1;
    for (let i = this.executionIndex + 1; i <= target; i++) {
      const s = this.sentences[i];
      if (s && s.phase === 'pending') { nextIdx = i; break; }
    }
    if (nextIdx === -1) {
      // All sentences in the window have been Added (or are already past
      // pending). Trigger a single Exec on the target; STM will process
      // every dependency in-worker with no JS round-trips between them.
      const t = this.sentences[target];
      if (t) this.worker.exec(t.sid);
      this.emitHighlights();
      return;
    }
    const s = this.sentences[nextIdx];
    s.phase = 'added';
    const tipSid = nextIdx > 0 ? this.sentences[nextIdx - 1].sid : 1;
    this.worker.add(tipSid, s.sid, this.transformForWorker(s.text));
    this.emitHighlights();
    // Wait for coqAdded to fire the next one.
  }

  private cancelToIndex(targetIdx: number): void {
    if (targetIdx < this.executionIndex && this.executionIndex >= 0) {
      // Cancel from targetIdx + 1 forward
      const cancelIdx = targetIdx + 1;
      if (cancelIdx < this.sentences.length) {
        this.worker.cancel(this.sentences[cancelIdx].sid);
        const trimSids = new Set<number>();
        for (let i = cancelIdx; i < this.sentences.length; i++) {
          this.sentences[i].phase = 'pending';
          trimSids.add(this.sentences[i].sid);
          this.syntheticFired.delete(this.sentences[i].sid);
        }
        this.callbacks.onActivityTrim?.(trimSids);
      }
      this.executionIndex = targetIdx;
      this.diagnostics = [];
      this.messages = [];

      // Request goals at new tip
      if (targetIdx >= 0) {
        this.worker.goals(this.sentences[targetIdx].sid);
      } else {
        this.currentGoals = null;
        this.emitProofView();
      }
      this.emitHighlights();
      this.emitDiagnostics();
    }
  }

  // --- CoqObserver Callbacks (called by CoqWorkerWrapper) ---

  coqReady(_sid: number): void {
    this.callbacks.onReady();
  }

  coqAdded(sid: number, _loc: unknown): void {
    const sentence = this.sentences.find(s => s.sid === sid);
    if (!sentence) return;
    sentence.phase = 'executing';
    this.emitHighlights();

    if (this._batchExec) {
      // Batch mode: chain to the next sentence's Add. When the window is
      // exhausted, _addNextInBatch fires a single Exec on the target.
      this._addNextInBatch();
    } else {
      // Single-step: immediately Exec this one sentence.
      this.worker.exec(sid);
    }
  }

  coqPending(sid: number, _prefix: unknown, _moduleNames: unknown): void {
    // Resolve pending sentence (may need re-add with resolve=true)
    const idx = this.sentences.findIndex(s => s.sid === sid);
    if (idx >= 0) {
      const tipSid = idx > 0 ? this.sentences[idx - 1].sid : 1;
      this.worker.add(tipSid, sid, this.transformForWorker(this.sentences[idx].text), true);
    }
  }

  feedProcessed(sid: number): void {
    const idx = this.sentences.findIndex(s => s.sid === sid);
    if (idx < 0) return;

    this.sentences[idx].phase = 'processed';
    // executionIndex tracks the furthest-processed sentence. In a batch, Coq
    // may process out of strict order inside STM, but feedProcessed arrives
    // in dependency order — keep the max.
    if (idx > this.executionIndex) this.executionIndex = idx;

    // Synthesize a "foo is defined" entry if Coq was silent.
    this.maybeSynthesizeActivity(idx);
    this.emitHighlights();

    const isBatchFinish = this._batchExec && idx === this._executeTarget;
    const isSingleStep = !this._batchExec;

    if (isBatchFinish || isSingleStep) {
      // Only query goals at the tip we actually care about — the user's
      // target for batch mode, or every step for single-step mode.
      this.worker.goals(sid);
      this.executing = false;
      this._batchExec = false;
      this._executeTarget = -1;

      // Process any pending user action queued while we were busy
      if (this.pendingAction) {
        const action = this.pendingAction;
        this.pendingAction = null;
        action();
      }
    }
    // else: intermediate sentence inside a batch; no goals query, stay busy.
  }

  feedProcessing(_sid: number): void {
    // Update highlights to show processing state
    this.emitHighlights();
  }

  feedMessage(sid: number, level: [string], _loc: unknown, msg: Pp): void {
    const severity = levelToSeverity(level[0]);
    this.messages.push([severity, ppToPpString(msg)]);
    this.emitProofView();

    // Persistent activity log entry (Notice/Info/Warning/Error messages)
    const sentence = this.sentences.find(s => s.sid === sid);
    const text = ppToText(msg).trim();
    if (text) {
      this.appendActivity({
        seq: ++this.activitySeq,
        sid,
        severity,
        text,
        sentencePreview: previewSentence(sentence?.text || ''),
        line: sentence?.startPos.line ?? -1,
        kind: 'message',
        timestamp: Date.now(),
      });
    }

    // Also create diagnostic for errors
    if (severity === 'Error') {
      if (sentence) {
        this.diagnostics.push({
          range: {
            start: { line: sentence.startPos.line, character: sentence.startPos.character },
            end: { line: sentence.endPos.line, character: sentence.endPos.character },
          },
          message: ppToText(msg),
          severity: 1,
        });
        this.emitDiagnostics();
      }
    }
  }

  private appendActivity(entry: ActivityEntry): void {
    this.callbacks.onActivityAppend?.(entry);
  }

  /**
   * Emit a synthetic "foo is defined" / "proof complete" / etc. entry if Coq
   * itself did not produce a message for this sentence. Keeps the activity log
   * useful even when jsCoq is silent about successful commands.
   */
  private maybeSynthesizeActivity(idx: number): void {
    const sentence = this.sentences[idx];
    if (!sentence || this.syntheticFired.has(sentence.sid)) return;

    const synthetic = describeVernacular(sentence.text);
    if (!synthetic) return;
    this.syntheticFired.add(sentence.sid);

    this.appendActivity({
      seq: ++this.activitySeq,
      sid: sentence.sid,
      severity: 'Information',
      text: synthetic,
      sentencePreview: previewSentence(sentence.text),
      line: sentence.startPos.line,
      kind: 'synthetic',
      timestamp: Date.now(),
    });
  }

  coqGoalInfo(_sid: number, goals: JsCoqGoals | null): void {
    this.currentGoals = goals;
    this.emitProofView();
  }

  coqCancelled(_sids: number[]): void {
    // Already handled in stepBackward/cancelToIndex
    this.executing = false;
  }

  coqCoqExn(info: { loc?: { bp?: number; ep?: number }; pp: Pp; msg?: string; sids?: number[] }): void {
    console.error('[CoqEngine] CoqExn:', JSON.stringify(info));
    this.executing = false;
    this._executeTarget = -1;
    this._batchExec = false;

    // Mark the current executing sentence as error
    const executingIdx = this.sentences.findIndex(s => s.phase === 'executing' || s.phase === 'added');
    if (executingIdx >= 0) {
      this.sentences[executingIdx].phase = 'error';
    }

    // Add error message
    const ppString = ppToPpString(info.pp);
    this.messages.push(['Error', ppString]);

    // Add diagnostic
    if (executingIdx >= 0) {
      const sentence = this.sentences[executingIdx];
      this.diagnostics.push({
        range: {
          start: { line: sentence.startPos.line, character: sentence.startPos.character },
          end: { line: sentence.endPos.line, character: sentence.endPos.character },
        },
        message: ppToText(info.pp),
        severity: 1,
      });
    }

    this.emitProofView();
    this.emitHighlights();
    this.emitDiagnostics();

    // Process pending action
    if (this.pendingAction) {
      const action = this.pendingAction;
      this.pendingAction = null;
      action();
    }
  }

  coqLog(_level: [string], _msg: Pp): void {
    // Debug logging — ignored for UI
  }

  coqModeInfo(_sid: number, _mode: string): void {
    // Mode change — could use for UI hints
  }

  coqCoqInfo(_info: unknown): void {
    // Coq version info — ignored
  }

  coqLibError(_bname: string, _msg: string): void {
    // Package errors handled in init() directly
  }

  feedFileLoaded(): void {}
  feedFileDependency(): void {}
  feedProcessingIn(): void {}
  feedAddedAxiom(): void {}
  feedIncomplete(): void {}

  // --- Emit UI Updates ---

  private emitProofView(): void {
    this.callbacks.onProofView(buildProofView(this.currentGoals, this.messages));
  }

  private emitHighlights(): void {
    const processed: HighlightRange[] = [];
    const processing: HighlightRange[] = [];

    for (const s of this.sentences) {
      const range: HighlightRange = {
        start: { line: s.startPos.line, character: s.startPos.character },
        end: { line: s.endPos.line, character: s.endPos.character },
      };

      if (s.phase === 'processed') {
        processed.push(range);
      } else if (s.phase === 'executing' || s.phase === 'added') {
        processing.push(range);
      }
    }

    // Merge contiguous processed ranges
    const mergedProcessed = mergeRanges(processed);

    this.callbacks.onHighlights({
      uri: '',
      preparedRange: [],
      processingRange: processing,
      processedRange: mergedProcessed,
    });
  }

  private emitDiagnostics(): void {
    this.callbacks.onDiagnostics([...this.diagnostics]);
  }
}

/**
 * Merge contiguous or overlapping highlight ranges.
 */
function mergeRanges(ranges: HighlightRange[]): HighlightRange[] {
  if (ranges.length <= 1) return ranges;

  const sorted = [...ranges].sort((a, b) =>
    a.start.line !== b.start.line ? a.start.line - b.start.line : a.start.character - b.start.character
  );

  const merged: HighlightRange[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = sorted[i];
    // Merge if overlapping or adjacent (same line, chars touch)
    if (
      curr.start.line < prev.end.line ||
      (curr.start.line === prev.end.line && curr.start.character <= prev.end.character)
    ) {
      if (
        curr.end.line > prev.end.line ||
        (curr.end.line === prev.end.line && curr.end.character > prev.end.character)
      ) {
        prev.end = curr.end;
      }
    } else {
      merged.push(curr);
    }
  }
  return merged;
}

/**
 * All directory prefixes for each .coq-pkg package.
 * Extracted from the actual zip contents of each package.
 * Every directory containing .vo or .cma files needs an entry.
 */
const PKG_DIRS: Record<string, string[][]> = {
  'init':            [['Coq','Init'],['Coq','Bool'],['Coq','Unicode'],['Coq','btauto'],
                      ['Coq','ssr'],['Coq','ssrmatching'],['Coq','ltac'],['Coq','syntax'],
                      ['Coq','cc'],['Coq','firstorder']],
  'ltac2':           [['Ltac2'],['Coq','ltac2']],
  'coq-base':        [['Coq','Classes'],['Coq','Logic'],['Coq','Program'],['Coq','Relations'],
                      ['Coq','Setoids'],['Coq','Structures'],['Coq','extraction'],['Coq','funind']],
  'coq-collections': [['Coq','FSets'],['Coq','Lists'],['Coq','MSets'],['Coq','Sets'],
                      ['Coq','Sorting'],['Coq','Vectors']],
  'coq-arith':       [['Coq','Arith'],['Coq','Array'],['Coq','NArith'],['Coq','Numbers'],
                      ['Coq','Numbers','Cyclic','Abstract'],['Coq','Numbers','Cyclic','Int31'],
                      ['Coq','Numbers','Cyclic','Int63'],['Coq','Numbers','Cyclic','ZModulo'],
                      ['Coq','Numbers','Integer','Abstract'],['Coq','Numbers','Integer','Binary'],
                      ['Coq','Numbers','Integer','NatPairs'],['Coq','Numbers','NatInt'],
                      ['Coq','Numbers','Natural','Abstract'],['Coq','Numbers','Natural','Binary'],
                      ['Coq','Numbers','Natural','Peano'],['Coq','PArith'],['Coq','QArith'],
                      ['Coq','Strings'],['Coq','Wellfounded'],['Coq','ZArith'],
                      ['Coq','omega'],['Coq','ring'],['Coq','setoid_ring']],
  'coq-reals':       [['Coq','Floats'],['Coq','Reals'],['Coq','Reals','Abstract'],
                      ['Coq','Reals','Cauchy'],['Coq','micromega'],['Coq','nsatz']],
  'sf-LF':           [['LF']],
  'sf-PLF':          [['PLF']],
  'sf-VFA':          [['VFA']],
  'sf-SLF':          [['SLF']],
};

/**
 * Shorten a sentence for display in the activity log — strip leading comments,
 * collapse whitespace, truncate with an ellipsis.
 */
function previewSentence(text: string): string {
  if (!text) return '';
  // Strip leading block comments (* ... *)
  let s = text;
  while (s.startsWith('(*')) {
    let depth = 1;
    let j = 2;
    while (j < s.length && depth > 0) {
      if (s[j] === '(' && s[j + 1] === '*') { depth++; j += 2; }
      else if (s[j] === '*' && s[j + 1] === ')') { depth--; j += 2; }
      else j++;
    }
    s = s.slice(j).trimStart();
  }
  s = s.replace(/\s+/g, ' ').trim();
  return s.length > 80 ? s.slice(0, 77) + '\u2026' : s;
}

/**
 * Heuristic: look at the sentence text and produce a user-facing description
 * ("foo is defined", "Qed: proof complete", ...) for when Coq is silent about
 * successful vernaculars. Returns null if the sentence is something like a
 * plain tactic where emitting a synthetic message would be noisy.
 */
const VERNAC_RE_SIMPLE =
  /^\s*(Definition|Fixpoint|CoFixpoint|Function|Let|Example|Theorem|Lemma|Fact|Remark|Corollary|Proposition|Inductive|CoInductive|Variant|Record|Structure|Class|Instance|Axiom|Hypothesis|Variable|Parameter|Notation|Module)\b\s+"?([A-Za-z_][\w']*)?/;

function describeVernacular(text: string): string | null {
  if (!text) return null;
  // Strip a leading block comment
  const cleaned = previewSentence(text);
  const trimmed = cleaned.trim();
  if (!trimmed) return null;

  // Qed / Defined / Admitted — proof closers
  if (/^(Qed|Defined|Admitted|Abort|Save)\s*\.?$/.test(trimmed)) {
    const word = trimmed.replace(/\.$/, '');
    if (word === 'Admitted') return 'proof admitted';
    if (word === 'Abort') return 'proof aborted';
    return 'proof complete';
  }

  const m = trimmed.match(VERNAC_RE_SIMPLE);
  if (!m) return null;
  const kind = m[1];
  const name = m[2];
  if (!name) return `${kind.toLowerCase()} registered`;
  if (kind === 'Notation') return `notation ${name} registered`;
  return `${name} is defined`;
}

function buildLibPathForPackages(packageNames: string[]): [string[], string[]][] {
  const seen = new Set<string>();
  const result: [string[], string[]][] = [];
  for (const pkg of packageNames) {
    for (const dir of (PKG_DIRS[pkg] || [])) {
      const key = dir.join('.');
      if (!seen.has(key)) {
        seen.add(key);
        result.push([dir, ['/lib']]);
      }
    }
  }
  return result;
}
