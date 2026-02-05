type SparklineProps = {
  data: number[];
  width?: number;
  height?: number;
  stroke?: string;
};

export function Sparkline({ data, width = 120, height = 28, stroke = '#7b2d2d' }: SparklineProps) {
  if (data.length === 0) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const step = width / Math.max(data.length - 1, 1);

  const points = data
    .map((value, idx) => {
      const x = idx * step;
      const y = height - ((value - min) / range) * height;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline fill="none" stroke={stroke} strokeWidth="2" points={points} />
    </svg>
  );
}
