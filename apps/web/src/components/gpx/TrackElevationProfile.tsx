"use client";

/** Profile point: distance in miles (d), elevation in feet (e). Stored per-track from enrichment. */
export type ProfilePoint = { d: number; e: number };

type TrackElevationProfileProps = {
  trackName: string;
  /** Points (d = distance miles, e = elevation ft). Null or too few points show fallback. */
  profilePoints: ProfilePoint[] | null;
};

export function TrackElevationProfile({ trackName, profilePoints }: TrackElevationProfileProps) {
  if (!profilePoints || profilePoints.length < 2) {
    return (
      <div className="flex h-full items-center justify-center rounded border border-slate-700 bg-slate-900/95 px-4 text-sm text-slate-400">
        Elevation profile not available for this track.
      </div>
    );
  }

  const distancesMi = profilePoints.map((p) => p.d);
  const elevationsFt = profilePoints.map((p) => p.e);
  const minMi = Math.min(...distancesMi);
  const maxMi = Math.max(...distancesMi);
  const minFt = Math.min(...elevationsFt);
  const maxFt = Math.max(...elevationsFt);
  const rangeMi = maxMi - minMi || 1;
  const rangeFt = maxFt - minFt || 1;

  const padding = { top: 12, right: 12, bottom: 28, left: 44 };
  const width = 600;
  const height = 160;
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const toX = (miles: number) =>
    padding.left + ((miles - minMi) / rangeMi) * chartWidth;
  const toY = (ft: number) =>
    padding.top + chartHeight - ((ft - minFt) / rangeFt) * chartHeight;

  const pathD = profilePoints
    .map((p, i) => {
      const x = toX(p.d);
      const y = toY(p.e);
      return `${i === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");

  const tickCountX = 5;
  const tickCountY = 4;
  const xTicks = Array.from({ length: tickCountX + 1 }, (_, i) => {
    const mi = minMi + (rangeMi * i) / tickCountX;
    return { mi, x: toX(mi) };
  });
  const yTicks = Array.from({ length: tickCountY + 1 }, (_, i) => {
    const ft = minFt + (rangeFt * i) / tickCountY;
    return { ft, y: toY(ft) };
  });

  return (
    <div className="flex h-full flex-col rounded border border-slate-700 bg-slate-900/95">
      <div className="border-b border-slate-700 px-3 py-1.5">
        <h3 className="text-sm font-medium text-slate-200">
          Elevation profile — {trackName}
        </h3>
      </div>
      <div className="flex-1 overflow-auto p-2">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="min-w-full max-w-full"
          preserveAspectRatio="xMidYMid meet"
          aria-label={`Elevation profile for ${trackName}`}
        >
          {/* Y-axis label */}
          <text
            x={padding.left - 8}
            y={height / 2}
            textAnchor="middle"
            dominantBaseline="middle"
            transform={`rotate(-90 ${padding.left - 8} ${height / 2})`}
            className="fill-slate-400 text-[10px]"
          >
            Elevation (ft)
          </text>
          {/* X-axis label */}
          <text
            x={width / 2}
            y={height - 6}
            textAnchor="middle"
            className="fill-slate-400 text-[10px]"
          >
            Distance (miles)
          </text>
          {/* Y ticks */}
          {yTicks.map(({ ft, y }) => (
            <g key={ft}>
              <line
                x1={padding.left}
                y1={y}
                x2={padding.left + chartWidth}
                y2={y}
                stroke="rgba(148, 163, 184, 0.2)"
                strokeWidth="0.5"
                strokeDasharray="2 2"
              />
              <text
                x={padding.left - 6}
                y={y}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-slate-500 text-[9px]"
              >
                {Math.round(ft).toLocaleString()}
              </text>
            </g>
          ))}
          {/* X ticks */}
          {xTicks.map(({ mi, x }) => (
            <g key={mi}>
              <line
                x1={x}
                y1={padding.top}
                x2={x}
                y2={padding.top + chartHeight}
                stroke="rgba(148, 163, 184, 0.2)"
                strokeWidth="0.5"
                strokeDasharray="2 2"
              />
              <text
                x={x}
                y={height - 10}
                textAnchor="middle"
                className="fill-slate-500 text-[9px]"
              >
                {mi.toFixed(2)}
              </text>
            </g>
          ))}
          {/* Line */}
          <path
            d={pathD}
            fill="none"
            stroke="rgb(56, 189, 248)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  );
}
