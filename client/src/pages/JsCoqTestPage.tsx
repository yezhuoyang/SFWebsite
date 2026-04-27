/**
 * Bare-bones smoke test: renders jsCoq's classic IDE in a full-page
 * container with a tiny Coq snippet preloaded. Mirrors what
 * coq.vercel.app's `scratchpad.html` does, just inside our React shell.
 *
 * Visit /jscoq-test once the bundle deploys; if the IDE comes up, package
 * loading and `Step Forward` work, then we're cleared to wire it into
 * ChapterPage.
 */

import JsCoqIDE from '../coq/JsCoqIDE';

const SAMPLE = `(* jsCoq IDE smoke test — same setup as coq.vercel.app/scratchpad.html *)

From Coq Require Import Lia.

Lemma plus_comm_smoke : forall n m, n + m = m + n.
Proof. lia. Qed.
`;

export default function JsCoqTestPage() {
  return (
    <div style={{ height: '100vh', width: '100vw', overflow: 'hidden' }}>
      <JsCoqIDE
        initialCode={SAMPLE}
        filename="scratchpad.v"
        initPkgs={['init']}
        allPkgs={['coq']}
      />
    </div>
  );
}
