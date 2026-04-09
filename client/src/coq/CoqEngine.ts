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
// fflate no longer needed — WA backend downloads packages itself
import type {
  ProofViewNotification,
  UpdateHighlights,
  CoqDiagnostic,
  HighlightRange,
  RocqMessage,
} from '../api/coqWebSocket';

/** Volume ID to jsCoq package name mapping.
 *  ltac2 is required by init (Coq.Init.Prelude depends on Ltac2.Notations). */
const VOLUME_PACKAGES: Record<string, string[]> = {
  lf:   ['init', 'ltac2', 'coq-base', 'coq-collections', 'sf-LF'],
  plf:  ['init', 'ltac2', 'coq-base', 'coq-collections', 'sf-PLF'],
  vfa:  ['init', 'ltac2', 'coq-base', 'coq-collections', 'coq-arith', 'sf-VFA'],
  slf:  ['init', 'ltac2', 'coq-base', 'coq-collections', 'sf-SLF'],
  secf: ['init', 'ltac2', 'coq-base', 'coq-collections'],
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

  // Package loading
  private packagesLoaded = 0;
  private packagesTotal = 0;

  // Base path for worker and package assets
  private basePath = '';

  constructor(callbacks: CoqEngineCallbacks) {
    this.callbacks = callbacks;
    this.worker = new CoqWorkerWrapper();
    this.worker.addObserver(this);
  }

  /**
   * Initialize the Coq engine using the WASM backend.
   * The WA worker handles package loading internally — we just send LoadPkg URLs.
   *
   * @param basePath Fully-resolved URL to jsCoq assets (e.g., 'https://host/jscoq/')
   * @param volumeId Volume being studied (e.g., 'lf', 'plf')
   */
  async init(basePath: string, volumeId: string): Promise<void> {
    this.basePath = basePath.endsWith('/') ? basePath : basePath + '/';

    console.log('[CoqEngine] Initializing WASM backend, basePath:', this.basePath);

    // 1. Create WASM worker
    const workerUrl = this.basePath + 'dist/wacoq_worker.js';
    console.log('[CoqEngine] Loading worker from:', workerUrl);
    await this.worker.createWorker(workerUrl, 'wa');

    // 2. Wait for Boot event (WASM worker signals when ready)
    await this.waitForBoot();

    // 3. Send LoadPkg for each package — the WA worker fetches them itself
    const packages = VOLUME_PACKAGES[volumeId] || VOLUME_PACKAGES.lf;
    this.packagesTotal = packages.length;
    this.packagesLoaded = 0;

    const pkgBaseUrl = this.basePath + 'coq-pkgs/';
    for (const pkg of packages) {
      const pkgUrl = pkgBaseUrl + pkg + '.coq-pkg';
      console.log(`[CoqEngine] Loading package: ${pkgUrl}`);
      this.worker.loadPkgWa(pkgUrl);
    }

    // 4. Wait for all packages to be loaded
    await this.waitForPackages(packages.length);
    console.log('[CoqEngine] All packages loaded');

    // 5. Build lib_path from loaded packages
    const libPath = this.buildLibPathFromPackages(packages);
    console.log('[CoqEngine] lib_path entries:', libPath.length);

    // 6. Init Coq + NewDoc
    this.worker.init(
      {
        implicit_libs: true,
        lib_path: libPath,
        top_name: 'Top',
      },
      {
        lib_init: ['Coq.Init.Prelude'],
      }
    );
    // coqReady callback will fire onReady
  }

  private waitForBoot(): Promise<void> {
    return new Promise((resolve) => {
      const origBoot = this.coqBoot?.bind(this);
      this.coqBoot = () => {
        origBoot?.();
        resolve();
      };
    });
  }

  coqBoot(): void {
    console.log('[CoqEngine] WASM boot complete');
  }

  private waitForPackages(count: number): Promise<void> {
    return new Promise((resolve) => {
      let loaded = 0;
      const origLoaded = this.coqLoadedPkg?.bind(this);
      this.coqLoadedPkg = (uris: string[]) => {
        origLoaded?.(uris);
        loaded++;
        this.packagesLoaded = loaded;
        this.callbacks.onLoadProgress?.(loaded / count, '');
        console.log(`[CoqEngine] Package loaded (${loaded}/${count})`);
        if (loaded >= count) resolve();
      };
    });
  }

  coqLoadedPkg(_uris: string[]): void {
    // overridden in waitForPackages
  }

  /**
   * Build lib_path for known packages.
   * Format: [[logical_prefix_components], [physical_dir_path]]
   */
  private buildLibPathFromPackages(packages: string[]): [string[], string[]][] {
    return buildLibPath(packages);
  }

  /**
   * Set or update the full document text.
   * Parses into sentences and diffs against current state.
   */
  setDocument(text: string): void {
    const newSentences = parseSentences(text);

    // Find divergence point — where do old and new sentences differ?
    let divergeIdx = 0;
    while (
      divergeIdx < this.sentences.length &&
      divergeIdx < newSentences.length &&
      this.sentences[divergeIdx].text === newSentences[divergeIdx].text
    ) {
      divergeIdx++;
    }

    // Cancel sentences from divergence point forward
    if (divergeIdx < this.sentences.length) {
      const cancelSid = this.sentences[divergeIdx].sid;
      this.worker.cancel(cancelSid);
      this.sentences = this.sentences.slice(0, divergeIdx);
      this.executionIndex = Math.min(this.executionIndex, divergeIdx - 1);
      this.executing = false;
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
      for (let i = this.executionIndex; i < this.sentences.length; i++) {
        this.sentences[i].phase = 'pending';
      }
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

  private executeSentence(idx: number): void {
    const sentence = this.sentences[idx];
    if (!sentence || sentence.phase !== 'pending') return;

    this.executing = true;
    this.messages = [];
    sentence.phase = 'added';

    // tip_sid is the sid of the previously processed sentence, or 1 (init state)
    const tipSid = idx > 0 ? this.sentences[idx - 1].sid : 1;
    this.worker.add(tipSid, sentence.sid, sentence.text);
  }

  private executeToIndex(targetIdx: number): void {
    // Store target and step forward iteratively via callbacks
    this._executeTarget = targetIdx;
    const nextIdx = this.executionIndex + 1;
    if (nextIdx <= targetIdx && nextIdx < this.sentences.length) {
      this.executeSentence(nextIdx);
    }
  }
  private _executeTarget = -1;

  private cancelToIndex(targetIdx: number): void {
    if (targetIdx < this.executionIndex && this.executionIndex >= 0) {
      // Cancel from targetIdx + 1 forward
      const cancelIdx = targetIdx + 1;
      if (cancelIdx < this.sentences.length) {
        this.worker.cancel(this.sentences[cancelIdx].sid);
        for (let i = cancelIdx; i < this.sentences.length; i++) {
          this.sentences[i].phase = 'pending';
        }
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
    if (sentence) {
      sentence.phase = 'executing';
      this.worker.exec(sid);
      this.emitHighlights();
    }
  }

  coqPending(sid: number, _prefix: unknown, _moduleNames: unknown): void {
    // Resolve pending sentence (may need re-add with resolve=true)
    const idx = this.sentences.findIndex(s => s.sid === sid);
    if (idx >= 0) {
      const tipSid = idx > 0 ? this.sentences[idx - 1].sid : 1;
      this.worker.add(tipSid, sid, this.sentences[idx].text, true);
    }
  }

  feedProcessed(sid: number): void {
    const idx = this.sentences.findIndex(s => s.sid === sid);
    if (idx < 0) return;

    this.sentences[idx].phase = 'processed';
    this.executionIndex = idx;
    this.executing = false;

    // Request goals for this sentence
    this.worker.goals(sid);
    this.emitHighlights();

    // Continue to target if we have one
    if (this._executeTarget > idx) {
      const nextIdx = idx + 1;
      if (nextIdx < this.sentences.length && nextIdx <= this._executeTarget) {
        this.executeSentence(nextIdx);
        return;  // Don't process pending action yet
      }
    }
    this._executeTarget = -1;

    // Process pending action
    if (this.pendingAction) {
      const action = this.pendingAction;
      this.pendingAction = null;
      action();
    }
  }

  feedProcessing(_sid: number): void {
    // Update highlights to show processing state
    this.emitHighlights();
  }

  feedMessage(sid: number, level: [string], _loc: unknown, msg: Pp): void {
    const severity = levelToSeverity(level[0]);
    this.messages.push([severity, ppToPpString(msg)]);
    this.emitProofView();

    // Also create diagnostic for errors
    if (severity === 'Error') {
      const sentence = this.sentences.find(s => s.sid === sid);
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
 * Known module prefixes for each package.
 * The WA backend loads packages itself so we can't read manifests;
 * these are the prefixes each .coq-pkg contains.
 */
const PACKAGE_PREFIXES: Record<string, string[]> = {
  'init':             ['Coq.Init', 'Coq.Bool', 'Coq.Unicode', 'Coq.ltac', 'Coq.btauto',
                       'Coq.cc', 'Coq.firstorder', 'Coq.ssr', 'Coq.ssrmatching', 'Coq.syntax'],
  'ltac2':            ['Ltac2', 'Coq.ltac2'],
  'coq-base':         ['Coq.Arith', 'Coq.Classes', 'Coq.FSets', 'Coq.Floats', 'Coq.Init',
                       'Coq.Lists', 'Coq.Logic', 'Coq.MSets', 'Coq.NArith', 'Coq.Numbers',
                       'Coq.PArith', 'Coq.Program', 'Coq.Setoids', 'Coq.Sorting',
                       'Coq.Strings', 'Coq.Structures', 'Coq.Vectors', 'Coq.Wellfounded',
                       'Coq.ZArith', 'Coq.Bool', 'Coq.Relations', 'Coq.omega',
                       'Coq.micromega', 'Coq.extraction', 'Coq.funind'],
  'coq-collections':  ['Coq.Sets', 'Coq.Lists', 'Coq.Sorting'],
  'coq-arith':        ['Coq.Arith', 'Coq.NArith', 'Coq.ZArith', 'Coq.QArith',
                       'Coq.Numbers', 'Coq.Reals', 'Coq.Compat'],
  'sf-LF':            ['LF'],
  'sf-PLF':           ['PLF'],
  'sf-VFA':           ['VFA'],
  'sf-SLF':           ['SLF'],
};

/**
 * Build lib_path from package names.
 * Format: [[logical_prefix_components], [physical_dir_path]]
 */
function buildLibPath(packageNames: string[]): [string[], string[]][] {
  const prefixSet = new Set<string>();
  for (const pkg of packageNames) {
    const prefixes = PACKAGE_PREFIXES[pkg];
    if (prefixes) {
      for (const p of prefixes) prefixSet.add(p);
    }
  }

  return [...prefixSet].map(prefix => {
    const components = prefix.split('.');
    const physPath = '/lib/' + components.join('/');
    return [components, [physPath]];
  });
}
