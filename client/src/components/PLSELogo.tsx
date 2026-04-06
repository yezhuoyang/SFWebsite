/**
 * Cartoon-style PLSE (Programming Languages & Software Engineering) logo.
 * Inspired by the wooden sign: def { Pλ⊢E }_
 * with scattered binary digits (0s and 1s).
 */

export function PLSELogo({ size = 120 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Background — warm wood-inspired rounded square */}
      <rect width="120" height="120" rx="16" fill="url(#plseWood)" />
      <rect width="120" height="120" rx="16" fill="rgba(0,0,0,0.02)" />

      {/* "def {" top-left */}
      <text x="10" y="22" fill="#5c3d1a" fontSize="13" fontFamily="'JetBrains Mono', monospace" fontWeight="700" opacity="0.85">def</text>
      <text x="45" y="22" fill="#5c3d1a" fontSize="16" fontFamily="'JetBrains Mono', monospace" fontWeight="300" opacity="0.7">{'{'}</text>

      {/* Large P */}
      <text x="16" y="72" fill="#6b3a0a" fontSize="48" fontFamily="Georgia, serif" fontWeight="700" opacity="0.9">P</text>

      {/* Large λ (lambda) */}
      <text x="52" y="72" fill="#6b3a0a" fontSize="48" fontFamily="Georgia, serif" fontWeight="700" fontStyle="italic" opacity="0.9">λ</text>

      {/* Binary digits scattered around P and λ */}
      <g fill="#8b6914" fontSize="7" fontFamily="monospace" opacity="0.45">
        <text x="38" y="32">0</text>
        <text x="45" y="37">1</text>
        <text x="52" y="32">0</text>
        <text x="58" y="38">1</text>
        <text x="64" y="33">0</text>
        <text x="70" y="38">0</text>
        <text x="76" y="33">1</text>
        <text x="42" y="42">0</text>
        <text x="48" y="47">0</text>
        <text x="68" y="43">1</text>
        <text x="74" y="48">0</text>
        <text x="80" y="43">0</text>
        <text x="35" y="50">0</text>
        <text x="82" y="52">1</text>
      </g>

      {/* ⊢ (turnstile) — proof symbol */}
      <g transform="translate(22, 78)" fill="#6b3a0a" opacity="0.8">
        <rect x="0" y="0" width="3" height="22" rx="1" />
        <rect x="3" y="9" width="16" height="3" rx="1" />
      </g>

      {/* E — Engineering */}
      <g transform="translate(55, 78)" fill="#6b3a0a" opacity="0.8">
        <rect x="0" y="0" width="3" height="22" rx="1" />
        <rect x="3" y="0" width="18" height="3" rx="1" />
        <rect x="3" y="9" width="14" height="3" rx="1" />
        <rect x="3" y="19" width="18" height="3" rx="1" />
      </g>

      {/* More binary digits around ⊢ and E */}
      <g fill="#8b6914" fontSize="6" fontFamily="monospace" opacity="0.35">
        <text x="40" y="82">0</text>
        <text x="46" y="87">1</text>
        <text x="78" y="82">0</text>
        <text x="84" y="87">1</text>
        <text x="40" y="96">1</text>
        <text x="78" y="96">0</text>
        <text x="84" y="92">1</text>
        <text x="88" y="98">0</text>
        <text x="92" y="88">1</text>
      </g>

      {/* "}_" bottom-left */}
      <text x="10" y="114" fill="#5c3d1a" fontSize="16" fontFamily="'JetBrains Mono', monospace" fontWeight="300" opacity="0.7">{'}'}</text>
      <text x="22" y="114" fill="#5c3d1a" fontSize="13" fontFamily="'JetBrains Mono', monospace" fontWeight="400" opacity="0.6">_</text>

      {/* Subtle glow on the letters */}
      <defs>
        <linearGradient id="plseWood" x1="0" y1="0" x2="120" y2="120">
          <stop offset="0%" stopColor="#f5e6c8" />
          <stop offset="40%" stopColor="#e8d5a8" />
          <stop offset="100%" stopColor="#dcc898" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/**
 * UCLA Computer Science wordmark logo.
 * Blue and gold color scheme matching the official UCLA branding.
 */
export function UCLACSLogo({ size = 120 }: { size?: number }) {
  return (
    <svg width={size * 2.2} height={size * 0.6} viewBox="0 0 264 72" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* UCLA blue background bar */}
      <rect width="264" height="72" rx="8" fill="#2774AE" />

      {/* UCLA text */}
      <text x="14" y="36" fill="#FFD100" fontSize="28" fontFamily="'Helvetica Neue', Arial, sans-serif" fontWeight="800" letterSpacing="2">UCLA</text>

      {/* Samueli / Computer Science */}
      <text x="110" y="28" fill="white" fontSize="11" fontFamily="'Helvetica Neue', Arial, sans-serif" fontWeight="300" letterSpacing="1">Samueli</text>
      <text x="110" y="44" fill="white" fontSize="13" fontFamily="'Helvetica Neue', Arial, sans-serif" fontWeight="600">Computer Science</text>

      {/* Thin gold accent line */}
      <rect x="105" y="16" width="1.5" height="36" fill="#FFD100" rx="1" />

      {/* PLSE subtitle */}
      <text x="14" y="58" fill="rgba(255,255,255,0.6)" fontSize="9" fontFamily="'Helvetica Neue', Arial, sans-serif" fontWeight="400" letterSpacing="1">PROGRAMMING LANGUAGES & SOFTWARE ENGINEERING</text>
    </svg>
  );
}
