/**
 * Read the user's edited code from the same-origin SF iframe.
 *
 * The iframe loads our `/sfproxy/chapter/...` route (same-origin with
 * the parent), so React can walk its DOM directly. wacoq sets up one
 * CodeMirror instance per `<div class="code">`. To grade, we collect
 * each instance's `getValue()` in document order and POST them to the
 * server's splice endpoint — the server reassembles the chapter file
 * with the original prose comments + Exercise headers around our
 * code blocks.
 *
 * Returns null when the iframe DOM isn't ready (still loading, or
 * cross-origin for some reason). Callers fall back to the clipboard
 * path in that case.
 */

type CodeMirrorLike = { getValue: () => string };

interface CMElement extends HTMLElement {
  CodeMirror?: CodeMirrorLike;
}

/** Read all editable code blocks from the SF iframe in document order. */
export function readChapterBlocks(iframe: HTMLIFrameElement | null): string[] | null {
  if (!iframe) return null;
  let doc: Document | null = null;
  try {
    doc = iframe.contentDocument;
  } catch {
    // Cross-origin error throws on access in some browsers — same
    // outcome as null.
    return null;
  }
  if (!doc) return null;
  const cms = doc.querySelectorAll('.CodeMirror');
  if (cms.length === 0) return null;
  const blocks: string[] = [];
  cms.forEach(el => {
    const cm = (el as CMElement).CodeMirror;
    if (cm && typeof cm.getValue === 'function') {
      blocks.push(cm.getValue());
    }
  });
  return blocks.length > 0 ? blocks : null;
}
