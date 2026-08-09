import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle, Line, Polyline, Text as SvgText } from 'react-native-svg';
import { colors } from '../theme';

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
  const polylinePoints = points.map(p => `${p.x},${p.y}`).join(' ');

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
        <Polyline points={polylinePoints} fill="none" stroke={color} strokeWidth={2} />
        {points.map((p, i) => (
          <Circle key={i} cx={p.x} cy={p.y} r={3} fill={color} />
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
