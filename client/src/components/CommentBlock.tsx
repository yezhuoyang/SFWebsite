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
    .replace(/\s*\*+\)\s*$/, '')
    .replace(/^\(\*\s*[#=\-]+\s*\*\)\s*/m, '')
    .trim();

  // Extract leading heading pattern: "* Title", "** Title", "*** Title", "**** Title"
  // that appears at the very start of a comment (the common SF convention for
  // multi-line doc comments like `(** *** Section Name` followed by body).
  // Stars count → heading level. We split title off and render the rest normally.
  let leadingHeading: { level: number; title: string } | null = null;
  const headingMatch = text.match(/^(\*{1,4})\s+([^\n]+?)\s*$/m);
  if (headingMatch && text.startsWith(headingMatch[0])) {
    leadingHeading = {
      level: Math.min(headingMatch[1].length, 4),
      title: headingMatch[2].replace(/:\s*$/, ''),
    };
    text = text.slice(headingMatch[0].length).replace(/^\n+/, '');
  }

  // Convert [text] to `code` markers
  text = text.replace(/\[([^\]]+)\]/g, '`$1`');
  // Convert _text_ to emphasis
  text = text.replace(/\b_([^_]+)_\b/g, '<em>$1</em>');

  // Split into paragraphs by blank lines
  const paragraphs = text.split(/\n\s*\n/);

  return (
    <div className="sf-prose">
      {leadingHeading && renderHeading(leadingHeading.level, leadingHeading.title)}
      {paragraphs.map((p, i) => {
        // Remove the common 4-space Coq doc comment indentation
        const dedented = p.replace(/^    /gm, '');

        const lines = dedented.split('\n');
        const hasRuleSeparators = lines.some(l => /^[\s]*[-]{3,}/.test(l) || /^[\s]*[=]{3,}/.test(l));
        const hasBNFPipes = lines.filter(l => /^\s*\|/.test(l)).length >= 2;

        // List items — check FIRST (before code block detection, since list
        // items may also be indented).
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

        // Indented code block: after removing the base 4-space comment
        // indentation, if every non-blank line still starts with at least 3
        // additional leading spaces, treat the paragraph as a code-like pre
        // block. The threshold of 3 discriminates against 2-space bullet
        // continuations while catching Imp/pseudocode samples like
        //     Z := X;
        //     Y := 1;
        //     while Z <> 0 do ... end
        // embedded in comment prose.
        const nonBlankLines = lines.filter(l => l.trim().length > 0);
        const looksLikeCode =
          nonBlankLines.length >= 2 &&
          nonBlankLines.every(l => /^   /.test(l));

        const isFormatted = hasRuleSeparators || hasBNFPipes || looksLikeCode;

        if (isFormatted) {
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

function renderHeading(level: number, title: string): React.ReactNode {
  const inline = renderInline(
    title.replace(/\[([^\]]+)\]/g, '`$1`').replace(/\b_([^_]+)_\b/g, '<em>$1</em>')
  );
  switch (level) {
    case 1: return <h2 className="sf-comment-h1">{inline}</h2>;
    case 2: return <h3 className="sf-comment-h2">{inline}</h3>;
    case 3: return <h4 className="sf-comment-h3">{inline}</h4>;
    default: return <h5 className="sf-comment-h4">{inline}</h5>;
  }
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
