/**
 * Helpers for reading state out of the same-origin SF book iframe.
 *
 * The iframe document hosts jsCoq's `CoqManager`, exposed as
 * `window.coq` by the embed script. Because the iframe is on our
 * origin (Vite's `sfbook-proxy` plugin serves it locally), we can
 * reach into it directly from React.
 *
 * All functions are safe to call before jsCoq has finished booting —
 * they return null/empty values until `iframe.contentWindow.coq`
 * exists and has a provider.
 */

// jsCoq's runtime types are sprawling — we only access a tiny subset
// dynamically, so use `any` rather than re-declaring them all.
/* eslint-disable @typescript-eslint/no-explicit-any */

interface Snippet {
  getValue?: () => string;
  filename?: string;
}

function getCoq(iframe: HTMLIFrameElement | null): any | null {
  if (!iframe) return null;
  try {
    const win = iframe.contentWindow as any;
    return win?.coq ?? null;
  } catch {
    return null;
  }
}

/**
 * Returns the concatenated text of all editable code blocks in the
 * iframe, joined with double newlines. This is what the user is
 * working on; we send it to the server for grading.
 */
export function readChapterCode(iframe: HTMLIFrameElement | null): string | null {
  const coq = getCoq(iframe);
  if (!coq) return null;
  const snippets: Snippet[] = coq.provider?.snippets ?? [];
  if (!snippets.length) return null;
  return snippets.map(s => s.getValue?.() ?? '').join('\n\n');
}

/**
 * Returns the rendered current proof goals as plain text, or null
 * when there is no active proof / the IDE hasn't booted.
 */
export function readProofText(iframe: HTMLIFrameElement | null): string | null {
  const coq = getCoq(iframe);
  if (!coq) return null;
  const proofEl = coq.layout?.proof as HTMLElement | undefined;
  return proofEl?.textContent?.trim() || null;
}

/**
 * Returns rendered diagnostic / message-panel text (errors, warnings,
 * notices). Empty string when nothing is displayed.
 */
export function readDiagnosticsText(iframe: HTMLIFrameElement | null): string {
  const coq = getCoq(iframe);
  if (!coq) return '';
  const queryEl = coq.layout?.query as HTMLElement | undefined;
  return queryEl?.textContent?.trim() ?? '';
}

/**
 * Returns the number of sentences the user has stepped past (advanced
 * the cursor over). Useful for tutor context (how far they've gotten).
 */
export function readProcessedSentenceCount(iframe: HTMLIFrameElement | null): number {
  const coq = getCoq(iframe);
  if (!coq?.doc?.sentences) return 0;
  return coq.doc.sentences.filter((s: any) => s?.phase?.name === 'PROCESSED').length;
}

/**
 * `true` once `window.coq` is set inside the iframe and its provider
 * snippets are present. Use to gate UI buttons that need the IDE.
 */
export function isCoqReady(iframe: HTMLIFrameElement | null): boolean {
  const coq = getCoq(iframe);
  return Boolean(coq?.provider?.snippets?.length);
}
