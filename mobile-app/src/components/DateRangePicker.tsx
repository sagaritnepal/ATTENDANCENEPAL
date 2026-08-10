import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal } from 'react-native';
import { buildMonth, formatAdDate, monthDateRange, stepAnchor, todayAnchor, type CalendarAnchor, type CalendarSystem } from '../lib/calendar';
import { useCalendarSystem } from '../lib/CalendarSystemContext';
import { colors } from '../theme';
import { CalendarIcon } from './icons';

const WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function parseAdKey(value: string): CalendarAnchor | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]) - 1, day: Number(m[3]) };
}
function isoDaysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function buildPresets(system: CalendarSystem): { label: string; from: string; to: string }[] {
  const today = todayAnchor();
  const thisMonth = monthDateRange(system, today);
  const lastMonth = monthDateRange(system, stepAnchor(system, today, -1));
  const todayIso = isoDaysAgo(0);
  return [
    { label: 'Today', from: todayIso, to: todayIso },
    { label: 'Last 7 days', from: isoDaysAgo(6), to: todayIso },
    { label: 'Last 30 days', from: isoDaysAgo(29), to: todayIso },
    { label: 'This month', from: thisMonth.start, to: thisMonth.end },
    { label: 'Last month', from: lastMonth.start, to: lastMonth.end },
  ];
}

export default function DateRangePicker({ from, to, onChange }: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  const { system } = useCalendarSystem();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<CalendarAnchor>(todayAnchor);
  const [pickingStart, setPickingStart] = useState<string | null>(null);

  function openPicker() {
    setAnchor(parseAdKey(from) ?? todayAnchor());
    setPickingStart(null);
    setOpen(true);
  }

  const month = useMemo(() => buildMonth(system, anchor), [system, anchor]);
  const presets = useMemo(() => buildPresets(system), [system]);

  function go(dir: 1 | -1) {
    setAnchor(stepAnchor(system, anchor, dir));
  }
  function goYear(dir: 1 | -1) {
    setAnchor(a => {
      let next = a;
      for (let i = 0; i < 12; i++) next = stepAnchor(system, next, dir);
      return next;
    });
  }

  function applyPreset(f: string, t: string) {
    onChange(f, t);
    setPickingStart(null);
    setOpen(false);
  }

  function selectCell(adKey: string) {
    if (!pickingStart) {
      setPickingStart(adKey);
      onChange(adKey, adKey);
      return;
    }
    const start = pickingStart < adKey ? pickingStart : adKey;
    const end = pickingStart < adKey ? adKey : pickingStart;
    onChange(start, end);
    setPickingStart(null);
    setOpen(false);
  }

  const liveStart = pickingStart ?? from;
  const liveEnd = pickingStart ?? to;

  return (
    <>
      <TouchableOpacity style={styles.trigger} onPress={openPicker}>
        <CalendarIcon size={14} color={colors.accent} />
        <Text style={styles.triggerText} numberOfLines={1}>
          {formatAdDate(from, system)} – {formatAdDate(to, system)}
        </Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setOpen(false)}>
          <TouchableOpacity activeOpacity={1} style={styles.sheet}>
            <View style={styles.presetsRow}>
              {presets.map(p => (
                <TouchableOpacity key={p.label} style={styles.presetChip} onPress={() => applyPreset(p.from, p.to)}>
                  <Text style={styles.presetChipText}>{p.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.navRow}>
              <View style={styles.navGroup}>
                <TouchableOpacity style={styles.navBtn} onPress={() => goYear(-1)}>
                  <Text style={styles.navBtnText}>«</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.navBtn} onPress={() => go(-1)}>
                  <Text style={styles.navBtnText}>‹</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.monthLabel}>{month.label}</Text>
              <View style={styles.navGroup}>
                <TouchableOpacity style={styles.navBtn} onPress={() => go(1)}>
                  <Text style={styles.navBtnText}>›</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.navBtn} onPress={() => goYear(1)}>
                  <Text style={styles.navBtnText}>»</Text>
                </TouchableOpacity>
              </View>
            </View>

            <Text style={styles.hint}>{pickingStart ? 'Pick the end date' : 'Pick the start date'}</Text>

            <View style={styles.weekdayRow}>
              {WEEKDAY_LABELS.map(w => (
                <Text key={w} style={styles.weekdayLabel}>
                  {w}
                </Text>
              ))}
            </View>
            {month.weeks.map((week, wi) => (
              <View key={wi} style={styles.weekRow}>
                {week.map((cell, ci) => {
                  const isStart = cell.adKey === liveStart;
                  const isEnd = cell.adKey === liveEnd;
                  const inRange = cell.adKey > liveStart && cell.adKey < liveEnd;
                  return (
                    <TouchableOpacity
                      key={ci}
                      style={[
                        styles.cell,
                        !cell.inMonth && { opacity: 0.3 },
                        (isStart || isEnd) && styles.cellSelected,
                        inRange && styles.cellInRange,
                        cell.isToday && !isStart && !isEnd && !inRange && styles.cellToday,
                      ]}
                      onPress={() => cell.inMonth && selectCell(cell.adKey)}
                      disabled={!cell.inMonth}
                    >
                      <Text style={[styles.cellText, (isStart || isEnd) && styles.cellTextSelected, cell.isToday && styles.cellTextToday]}>
                        {cell.displayDay}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: colors.slate200, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: colors.white },
  triggerText: { fontSize: 14, fontWeight: '600', color: colors.ink, flexShrink: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'center', padding: 20 },
  sheet: { backgroundColor: colors.white, borderRadius: 16, padding: 16 },
  presetsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, borderBottomWidth: 1, borderBottomColor: colors.slate100, paddingBottom: 12, marginBottom: 10 },
  presetChip: { borderWidth: 1, borderColor: colors.slate200, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
  presetChipText: { fontSize: 11, fontWeight: '600', color: colors.slate500 },
  navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  navGroup: { flexDirection: 'row', gap: 4 },
  navBtn: { borderWidth: 1, borderColor: colors.slate200, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  navBtnText: { fontSize: 13, color: colors.slate500 },
  monthLabel: { fontSize: 15, fontWeight: '700', color: colors.ink },
  hint: { fontSize: 11, color: colors.slate400, textAlign: 'center', marginBottom: 6 },
  weekdayRow: { flexDirection: 'row' },
  weekdayLabel: { flex: 1, textAlign: 'center', fontSize: 10, fontWeight: '600', color: colors.slate400 },
  weekRow: { flexDirection: 'row', marginTop: 4 },
  cell: { flex: 1, aspectRatio: 1, minHeight: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 999 },
  cellSelected: { backgroundColor: colors.accent },
  cellInRange: { backgroundColor: colors.accentLight },
  cellToday: { backgroundColor: colors.accentLight },
  cellText: { fontSize: 13, color: colors.slate500 },
  cellTextSelected: { color: colors.white, fontWeight: '700' },
  cellTextToday: { color: colors.accent, fontWeight: '700' },
});
