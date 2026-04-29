/**
 * Read / write the user's edited code through the same-origin SF
 * iframe.
 *
 * The iframe loads our `/sfproxy/chapter/...` route (same-origin with
 * the parent), so React can walk its DOM directly. wacoq sets up one
 * CodeMirror instance per `<div class="code">`. To grade, we collect
 * each instance's `getValue()` in document order; to restore a saved
 * solution after page reload, we push the saved values back into the
 * editors via `setValue()`.
 *
 * Returns null when the iframe DOM isn't ready (still loading, or
 * cross-origin for some reason). Callers fall back to the clipboard
 * path in that case.
 */

type CodeMirrorLike = {
  getValue: () => string;
  setValue: (s: string) => void;
};

interface CMElement extends HTMLElement {
  CodeMirror?: CodeMirrorLike;
}

function getCMs(iframe: HTMLIFrameElement | null): CMElement[] | null {
  if (!iframe) return null;
  let doc: Document | null = null;
  try {
    doc = iframe.contentDocument;
  } catch {
    return null;
  }
  if (!doc) return null;
  const els = doc.querySelectorAll('.CodeMirror');
  return els.length > 0 ? Array.from(els) as CMElement[] : null;
}

/** Read all editable code blocks from the SF iframe in document order. */
export function readChapterBlocks(iframe: HTMLIFrameElement | null): string[] | null {
  const cms = getCMs(iframe);
  if (!cms) return null;
  const blocks: string[] = [];
  for (const el of cms) {
    const cm = el.CodeMirror;
    if (cm && typeof cm.getValue === 'function') {
      blocks.push(cm.getValue());
    }
  }
  return blocks.length > 0 ? blocks : null;
}

/** Restore previously-saved blocks into the iframe's CodeMirror
 *  instances by index. Returns the number of blocks actually pushed. */
export function writeChapterBlocks(iframe: HTMLIFrameElement | null, blocks: string[]): number {
  const cms = getCMs(iframe);
  if (!cms) return 0;
  let n = 0;
  for (let i = 0; i < cms.length && i < blocks.length; i++) {
    const cm = cms[i].CodeMirror;
    if (cm && typeof cm.setValue === 'function') {
      // Avoid clobbering identical content — preserves cursor / undo
      // history when the saved blocks already match the editor.
      if (cm.getValue() !== blocks[i]) {
        cm.setValue(blocks[i]);
      }
      n++;
    }
  }
  return n;
}
