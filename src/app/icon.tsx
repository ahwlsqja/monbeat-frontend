import { ImageResponse } from 'next/og';

export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

/**
 * Dynamic favicon — renders a 32×32 icon with a purple circle and
 * "M" letter, matching the MonBeat brand.
 */
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 32,
          height: 32,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '50%',
          background: 'linear-gradient(135deg, #7c3aed, #4ade80)',
        }}
      >
        <span
          style={{
            fontSize: 18,
            fontWeight: 900,
            color: '#fff',
            lineHeight: 1,
          }}
        >
          M
        </span>
      </div>
    ),
    { ...size },
  );
}
