import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { colors } from '../theme';
import type { DayStatus } from '../lib/shift';
import { buildMonth, localDateKey as calLocalDateKey, stepAnchor, todayAnchor, type CalendarAnchor } from '../lib/calendar';
import { useCalendarSystem } from '../lib/CalendarSystemContext';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function MonthCalendarGrid({
  dayStatus,
  leaveDates,
  weekOffDates,
  selectedDate,
  onSelectDate,
  onMonthChange,
}: {
  dayStatus: Map<string, DayStatus>;
  leaveDates?: Set<string>;
  weekOffDates?: Set<string>;
  selectedDate: string | null;
  onSelectDate: (adKey: string) => void;
  onMonthChange?: (adKeys: string[]) => void;
}) {
  const { system } = useCalendarSystem();
  const [anchor, setAnchor] = useState<CalendarAnchor>(todayAnchor);
  const { weeks, label } = useMemo(() => buildMonth(system, anchor), [system, anchor]);
  const todayKey = useMemo(() => calLocalDateKey(new Date().toISOString()), []);

  useEffect(() => {
    onMonthChange?.(weeks.flat().filter(c => c.inMonth).map(c => c.adKey));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weeks]);

  function go(dir: 1 | -1) {
    setAnchor(stepAnchor(system, anchor, dir));
  }

  return (
    <View style={styles.container}>
      <View style={styles.nav}>
        <TouchableOpacity style={styles.navBtn} onPress={() => go(-1)}>
          <Text style={styles.navBtnText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.monthLabel}>{label}</Text>
        <TouchableOpacity style={styles.navBtn} onPress={() => go(1)}>
          <Text style={styles.navBtnText}>→</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.weekdayRow}>
        {WEEKDAY_LABELS.map(w => (
          <Text key={w} style={styles.weekdayLabel}>
            {w}
          </Text>
        ))}
      </View>

      {weeks.map((week, wi) => (
        <View key={wi} style={styles.weekRow}>
          {week.map((cell, ci) => {
            const status = dayStatus.get(cell.adKey);
            const onLeave = leaveDates?.has(cell.adKey) ?? false;
            const onWeekOff = weekOffDates?.has(cell.adKey) ?? false;
            const selected = selectedDate === cell.adKey;
            const isPastOrToday = cell.adKey <= todayKey;

            let bg = colors.white;
            let textColor: string = cell.inMonth ? colors.ink : colors.slate400;
            let late = false;
            let early = false;
            let overtime = false;

            if (cell.inMonth) {
              if (onLeave || onWeekOff) {
                bg = '#fefce8';
              } else if (status) {
                late = status.isLate;
                early = status.isEarly;
                overtime = status.overtimeMinutes > 0;
                if (status.hasOut) bg = colors.goodBg;
                else if (status.hasIn) bg = '#fdf2f8';
              } else if (isPastOrToday) {
                bg = colors.slate100;
              }
              if (cell.isToday) textColor = colors.accent;
            }
            if (selected) {
              bg = colors.accent;
              textColor = colors.white;
            }

            return (
              <TouchableOpacity
                key={ci}
                style={[styles.cell, { backgroundColor: bg }]}
                onPress={() => onSelectDate(cell.adKey)}
                disabled={!cell.inMonth}
              >
                {late && (
                  <View style={[styles.pill, styles.pillTop, { backgroundColor: selected ? colors.white : colors.warning }]}>
                    <Text style={[styles.pillText, { color: selected ? colors.accent : colors.white }]}>Late</Text>
                  </View>
                )}
                <Text style={[styles.cellText, { color: textColor, fontWeight: cell.isToday ? '700' : '400' }]}>{cell.displayDay}</Text>
                {(overtime || early) && (
                  <View style={styles.pillBottomRow}>
                    {overtime && (
                      <View style={[styles.pill, { backgroundColor: selected ? colors.white : colors.info }]}>
                        <Text style={[styles.pillText, { color: selected ? colors.accent : colors.white }]}>OT</Text>
                      </View>
                    )}
                    {early && (
                      <View style={[styles.pill, { backgroundColor: selected ? colors.white : colors.critical }]}>
                        <Text style={[styles.pillText, { color: selected ? colors.accent : colors.white }]}>Early</Text>
                      </View>
                    )}
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      ))}

      <View style={styles.legend}>
        <LegendDot color={colors.goodBg} label="Present" />
        <LegendDot color="#fdf2f8" label="Checked in" />
        <LegendDot color="#fefce8" label="On leave / Week Off" />
        <LegendDot color={colors.slate100} label="Absent" />
      </View>
    </View>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendSwatch, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.white, borderRadius: 12, borderWidth: 1, borderColor: colors.slate200, padding: 10 },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16, marginBottom: 8 },
  navBtn: { borderWidth: 1, borderColor: colors.slate200, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 },
  navBtnText: { color: colors.slate500, fontSize: 14 },
  monthLabel: { fontSize: 20, fontWeight: '700', color: colors.ink, minWidth: 150, textAlign: 'center' },
  weekdayRow: { flexDirection: 'row' },
  weekdayLabel: { flex: 1, textAlign: 'center', fontSize: 10, fontWeight: '600', color: colors.slate400, textTransform: 'uppercase', paddingVertical: 4 },
  weekRow: { flexDirection: 'row', gap: 2, marginBottom: 2 },
  cell: { flex: 1, minHeight: 54, borderRadius: 8, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  cellText: { fontSize: 20 },
  pill: { borderRadius: 20, paddingHorizontal: 4, paddingVertical: 1 },
  pillTop: { position: 'absolute', top: 2 },
  pillBottomRow: { position: 'absolute', bottom: 2, flexDirection: 'row', gap: 2 },
  pillText: { fontSize: 7, fontWeight: '700', textTransform: 'uppercase' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendSwatch: { height: 10, width: 10, borderRadius: 2 },
  legendText: { fontSize: 10, color: colors.slate500 },
});
