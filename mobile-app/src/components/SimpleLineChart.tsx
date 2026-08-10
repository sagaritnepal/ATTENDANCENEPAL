import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';
import { colors } from '../theme';

// Catmull-Rom -> cubic Bezier so the line reads as a smooth curve like
// recharts' type="monotone", instead of a jagged straight-segment polyline.
function smoothPath(points: { x: number; y: number }[]) {
  if (points.length < 2) return '';
  let d = `M ${points[0].x},${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
  }
  return d;
}

export default function SimpleLineChart({
  data,
  height = 180,
  color = colors.accent,
}: {
  data: { label: string; value: number }[];
  height?: number;
  color?: string;
}) {
  const width = 320;
  const padding = { top: 12, right: 12, bottom: 24, left: 28 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;
  const maxVal = Math.max(1, ...data.map(d => d.value));
  const stepX = data.length > 1 ? chartW / (data.length - 1) : 0;

  const points = data.map((d, i) => {
    const x = padding.left + i * stepX;
    const y = padding.top + chartH - (d.value / maxVal) * chartH;
    return { x, y, ...d };
  });
  const yTicks = [0, Math.round(maxVal / 2), maxVal];

  return (
    <View>
      <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        {yTicks.map(t => {
          const y = padding.top + chartH - (t / maxVal) * chartH;
          return (
            <React.Fragment key={t}>
              <Line x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke={colors.slate200} strokeWidth={1} />
              <SvgText x={padding.left - 6} y={y + 3} fontSize={9} fill={colors.slate400} textAnchor="end">
                {t}
              </SvgText>
            </React.Fragment>
          );
        })}
        <Path d={smoothPath(points)} fill="none" stroke={color} strokeWidth={2} />
        {points.map((p, i) => (
          <Circle key={i} cx={p.x} cy={p.y} r={4} fill={color} stroke={colors.white} strokeWidth={1.5} />
        ))}
        {points.map((p, i) => (
          <SvgText key={`l-${i}`} x={p.x} y={height - 6} fontSize={9} fill={colors.slate400} textAnchor="middle">
            {p.label}
          </SvgText>
        ))}
      </Svg>
    </View>
  );
}

export function LineChartLegend({ label, color }: { label: string; color: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { height: 8, width: 8, borderRadius: 4 },
  legendText: { fontSize: 11, color: colors.slate500 },
});
