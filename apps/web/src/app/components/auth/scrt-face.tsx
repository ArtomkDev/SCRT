const leftEyeX = 170;
const rightEyeX = 421;
const smile = `M${leftEyeX} 380Q${(leftEyeX + rightEyeX) / 2} 488 ${rightEyeX} 380`;

/** Code-built SCRT identity. The original artwork is a proportions reference only. */
export function ScrtFace() {
  return <div className="auth-face-artwork">
    <svg className="auth-face-svg" viewBox="0 0 640 640" fill="none" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="scrt-feature-fill" x1="143" y1="153" x2="408" y2="410" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fff" /><stop offset="1" stopColor="#e4e9ee" />
        </linearGradient>
        <filter id="scrt-edge-soft" x="0" y="0" width="640" height="640" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feGaussianBlur stdDeviation="2.5" />
        </filter>
      </defs>
      {/* Eyes and smile share their horizontal coordinates at rest. */}
      <g className="auth-face-features">
        <g className="auth-face-eye">
          <rect x={leftEyeX - 32.5} y="151" width="65" height="150" rx="32.5" fill="#fff" opacity=".35" filter="url(#scrt-edge-soft)" />
          <rect x={leftEyeX - 30.5} y="153" width="61" height="146" rx="30.5" fill="url(#scrt-feature-fill)" />
          <circle cx={rightEyeX} cy="278" r="35" fill="#fff" opacity=".35" filter="url(#scrt-edge-soft)" />
          <circle cx={rightEyeX} cy="278" r="33" fill="url(#scrt-feature-fill)" />
        </g>
        <g className="auth-face-mouth">
          <path className="auth-face-halo" d={smile} stroke="#fff" strokeWidth="44" strokeLinecap="round" filter="url(#scrt-edge-soft)" />
          <path className="auth-face-smile" d={smile} stroke="url(#scrt-feature-fill)" strokeWidth="40" strokeLinecap="round" />
        </g>
      </g>
    </svg>
  </div>;
}
