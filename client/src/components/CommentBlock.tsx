/**
 * Renders Coq documentation comments as readable prose,
 * styled to match the original Software Foundations website.
 *
 * Preserves formatting for indented content (BNF grammars,
 * inference rules, code-like blocks) while reflowing prose paragraphs.
 */

interface Props {
  content: string;
}

export default function CommentBlock({ content }: Props) {
  let text = content
    .replace(/^\(\*\*\s*/, '')
    .replace(/\s*\*\)\s*$/, '')
    .replace(/^\(\*\s*[#=\-]+\s*\*\)\s*/m, '')
    .trim();

  // Convert [text] to `code` markers
  text = text.replace(/\[([^\]]+)\]/g, '`$1`');
  // Convert _text_ to emphasis
  text = text.replace(/\b_([^_]+)_\b/g, '<em>$1</em>');

  // Split into paragraphs by blank lines
  const paragraphs = text.split(/\n\s*\n/);

  return (
    <div className="sf-prose">
      {paragraphs.map((p, i) => {
        // Remove the common 4-space Coq doc comment indentation
        const dedented = p.replace(/^    /gm, '');

        // Detect if this paragraph is "formatted" content that needs
        // line breaks preserved (BNF, inference rules, indented code):
        // - Has lines starting with significant whitespace (4+ spaces after dedent)
        // - Has lines with --- or === (inference rule separators)
        // - Has lines with | (BNF alternatives)
        // - Has very short lines (< 40 chars) that look like structured content
        const lines = dedented.split('\n');
        const hasIndentedLines = lines.some(l => /^\s{2,}\S/.test(l));
        const hasRuleSeparators = lines.some(l => /^[\s]*[-]{3,}/.test(l) || /^[\s]*[=]{3,}/.test(l));
        const hasBNFPipes = lines.filter(l => /^\s*\|/.test(l)).length >= 2;
        const mostlyShortLines = lines.length >= 3 && lines.filter(l => l.trim().length > 0 && l.trim().length < 45).length > lines.length * 0.6;
        const hasArrows = dedented.includes('==>') || dedented.includes('->') || dedented.includes(':=');

        // List items — check BEFORE isFormatted to prevent lists with
        // arrows/indentation from rendering as blue preformatted blocks
        const reflowed = dedented.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
        if (dedented.match(/^\s*-\s/) || reflowed.match(/^\s*-\s/)) {
          const items = dedented.split(/\n\s*-\s/).map(s => s.replace(/^-\s*/, '').replace(/\s+/g, ' ').trim());
          return (
            <ul key={i}>
              {items.filter(Boolean).map((item, j) => (
                <li key={j}>{renderInline(item)}</li>
              ))}
            </ul>
          );
        }

        const isFormatted = hasRuleSeparators || hasBNFPipes ||
          (hasIndentedLines && !lines.some(l => /^\s*-\s/.test(l)) && (hasArrows || mostlyShortLines));

        if (isFormatted) {
          // Preserve line breaks — render as preformatted block
          return (
            <pre key={i} className="sf-prose-pre">
              {lines.map((line, j) => (
                <span key={j}>{renderInline(line)}{j < lines.length - 1 ? '\n' : ''}</span>
              ))}
            </pre>
          );
        }

        if (!reflowed) return null;

        return <p key={i}>{renderInline(reflowed)}</p>;
      })}
    </div>
  );
}

function renderInline(text: string): React.ReactNode[] {
  const parts = text.split(/(`[^`]+`|<em>[^<]+<\/em>)/g);
  return parts.map((part, j) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={j}>{part.slice(1, -1)}</code>;
    }
    if (part.startsWith('<em>') && part.endsWith('</em>')) {
      return <em key={j}>{part.slice(4, -5)}</em>;
    }
    return <span key={j}>{part}</span>;
  });
}
