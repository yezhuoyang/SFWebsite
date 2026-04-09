/**
 * Thin wrapper around the jsCoq Web Worker.
 * Communicates via postMessage/onmessage without importing any jsCoq frontend deps.
 *
 * Protocol (from jscoq/backend/coq-worker.ts):
 *   Client -> Worker: ["Init", opts], ["NewDoc", docOpts], ["Add", tipSid, newSid, text, resolve],
 *                     ["Exec", sid], ["Cancel", sid], ["Query", sid, rid, ["Goals"]],
 *                     ["LoadPkg", basePath, pkg], ["Register", filename],
 *                     ["InterruptSetup", sharedInt32Array]
 *   Worker -> Client: ["CoqInfo", info], ["Ready", sid], ["Added", sid, loc],
 *                     ["Feedback", {span_id, route, contents: [tag, ...args]}],
 *                     ["GoalInfo", sid, goals], ["CoqExn", {loc, pp, sids}],
 *                     ["Cancelled", sids], ["Log", level, msg],
 *                     ["Pending", sid, ...], ["JsonExn", msg],
 *                     ["LibProgress", info], ["LoadedPkg", uris], ["ModeInfo", sid, mode]
 */

export type Block_type =
  | ['Pp_hbox']
  | ['Pp_vbox', number]
  | ['Pp_hvbox', number]
  | ['Pp_hovbox', number];

export type Pp =
  | ['Pp_empty']
  | ['Pp_string', string]
  | ['Pp_glue', Pp[]]
  | ['Pp_box', Block_type, Pp]
  | ['Pp_tag', string, Pp]
  | ['Pp_print_break', number, number]
  | ['Pp_force_newline']
  | ['Pp_comment', string[]];

/** A hypothesis: [names, def_or_null, type]. Names are ["Id", "name_str"]. */
export type CoqHyp = [['Id', string][], Pp | null, Pp];

/** A single goal from jsCoq */
export interface JsCoqGoal {
  name: unknown;
  hyp: CoqHyp[];
  ty: Pp;
}

/** Goal info returned by jsCoq Query Goals */
export interface JsCoqGoals {
  goals: JsCoqGoal[];
  stack: [JsCoqGoal[], JsCoqGoal[]][];  // unfocused goals (pairs)
  shelf: JsCoqGoal[];
  given_up: JsCoqGoal[];
  bullet?: Pp | null;
}

/** Feedback message content tags */
export type FeedbackTag =
  | 'Processed' | 'Processing' | 'Incomplete'
  | 'Complete' | 'AddedAxiom'
  | 'FileDependency' | 'FileLoaded'
  | 'Message' | 'ProcessingIn';

export interface FeedbackMsg {
  span_id: number;
  route: number;
  contents: [FeedbackTag, ...unknown[]];
}

/** Observer callbacks that CoqEngine implements */
export interface CoqObserver {
  coqReady?(sid: number): void;
  coqAdded?(sid: number, loc: unknown): void;
  coqPending?(sid: number, prefix: unknown, moduleNames: unknown): void;
  coqCancelled?(sids: number[]): void;
  coqGoalInfo?(sid: number, goals: JsCoqGoals | null): void;
  coqCoqExn?(info: { loc?: { bp?: number; ep?: number }; pp: Pp; msg?: string; sids?: number[] }): void;
  coqLog?(level: [string], msg: Pp): void;
  coqModeInfo?(sid: number, mode: string): void;
  coqCoqInfo?(info: unknown): void;
  coqLibError?(bname: string, msg: string): void;

  // Feedback sub-dispatches (feed + tag name)
  feedProcessed?(sid: number): void;
  feedProcessing?(sid: number): void;
  feedMessage?(sid: number, level: [string], loc: unknown, msg: Pp): void;
  feedFileLoaded?(): void;
  feedFileDependency?(): void;
  feedProcessingIn?(): void;
  feedAddedAxiom?(): void;
  feedIncomplete?(sid: number): void;
  feedComplete?(): void;
  feedSearchResults?(results: unknown): void;

  // Package loading
  coqLibProgress?(info: unknown): void;
  coqLoadedPkg?(uris: string[]): void;
}

export class CoqWorkerWrapper {
  private worker: Worker | null = null;
  private observers: CoqObserver[] = [];
  private intvec: Int32Array | null = null;
  private debug = true;

  constructor() {
    // Worker created lazily in init()
  }

  /**
   * Create the Web Worker and set up message handling.
   * @param workerUrl URL to jscoq_worker.bc.js (e.g., '/jscoq/backend/jsoo/jscoq_worker.bc.js')
   */
  async createWorker(workerUrl: string): Promise<void> {
    this.worker = new Worker(workerUrl);
    this.worker.addEventListener('message', (evt) => this.handleMessage(evt.data));

    // Set up interrupt via SharedArrayBuffer if available
    if (typeof SharedArrayBuffer !== 'undefined') {
      try {
        this.intvec = new Int32Array(new SharedArrayBuffer(4));
        this.worker.postMessage(['InterruptSetup', this.intvec]);
      } catch {
        console.warn('SharedArrayBuffer available but not serializable — interrupts disabled');
        this.intvec = null;
      }
    }
  }

  addObserver(obs: CoqObserver): void {
    this.observers.push(obs);
  }

  removeObserver(obs: CoqObserver): void {
    const idx = this.observers.indexOf(obs);
    if (idx >= 0) this.observers.splice(idx, 1);
  }

  // --- Commands to Worker ---

  init(coqOpts: object, docOpts?: object): void {
    this.send(['Init', coqOpts]);
    if (docOpts) this.send(['NewDoc', docOpts]);
  }

  add(tipSid: number, newSid: number, text: string, resolve = false): void {
    this.send(['Add', tipSid, newSid, text, resolve]);
  }

  exec(sid: number): void {
    this.send(['Exec', sid]);
  }

  cancel(sid: number): void {
    this.send(['Cancel', sid]);
  }

  goals(sid: number): void {
    this.send(['Query', sid, 0, ['Goals']]);
  }

  loadPkg(basePath: string, pkg: string): void {
    this.send(['LoadPkg', basePath, pkg]);
  }

  register(filename: string): void {
    this.send(['Register', filename]);
  }

  put(filename: string, content: ArrayBuffer): void {
    this.worker?.postMessage(['Put', filename, content]);
  }

  interrupt(): void {
    if (this.intvec) {
      Atomics.add(this.intvec, 0, 1);
    }
  }

  terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  // --- Internal ---

  private send(msg: unknown[]): void {
    if (this.debug) console.log('[CoqWorker →]', msg);
    this.worker?.postMessage(msg);
  }

  private handleMessage(msg: unknown[]): void {
    if (!Array.isArray(msg) || msg.length === 0) return;

    const tag = msg[0] as string;
    const args = msg.slice(1);

    if (this.debug) {
      if (tag !== 'LibProgress') console.log('[CoqWorker ←]', msg);
    }

    // Feedback messages are dispatched as feed+SubTag
    if (tag === 'Feedback') {
      this.handleFeedback(args[0] as FeedbackMsg, args[1]);
      return;
    }

    // Standard messages: call obs.coq<Tag>(...args)
    const methodName = 'coq' + tag;
    let handled = false;
    for (const obs of this.observers) {
      const handler = (obs as Record<string, unknown>)[methodName];
      if (typeof handler === 'function') {
        (handler as Function).apply(obs, args);
        handled = true;
      }
    }

    if (!handled && this.debug) {
      console.warn('[CoqWorker] Unhandled:', tag, args);
    }
  }

  private handleFeedback(fbMsg: FeedbackMsg, _inMode: unknown): void {
    const feedTag = fbMsg.contents[0];
    const feedArgs = [fbMsg.span_id, ...fbMsg.contents.slice(1), _inMode];

    const methodName = 'feed' + feedTag;
    let handled = false;
    for (const obs of this.observers) {
      const handler = (obs as Record<string, unknown>)[methodName];
      if (typeof handler === 'function') {
        (handler as Function).apply(obs, feedArgs);
        handled = true;
      }
    }

    if (!handled && this.debug) {
      console.warn('[CoqWorker] Unhandled feedback:', feedTag, feedArgs);
    }
  }
}
