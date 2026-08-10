import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal } from 'react-native';
import { buildMonth, formatAdDate, stepAnchor, todayAnchor, type CalendarAnchor } from '../lib/calendar';
import { useCalendarSystem } from '../lib/CalendarSystemContext';
import { colors } from '../theme';
import { CalendarIcon } from './icons';

const WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function parseAdKey(value: string): CalendarAnchor | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]) - 1, day: Number(m[3]) };
}

/** Single-date tap-to-pick calendar with an AD/BS switch, matching
 * admin-web's DatePicker — used wherever a form needs one date (leave
 * start/end, a missed-punch correction date) instead of a from/to range. */
export default function DatePicker({
  value,
  onChange,
  placeholder = 'Select date',
}: {
  value: string;
  onChange: (adKey: string) => void;
  placeholder?: string;
}) {
  const { system } = useCalendarSystem();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<CalendarAnchor>(todayAnchor);

  function openPicker() {
    setAnchor(parseAdKey(value) ?? todayAnchor());
    setOpen(true);
  }

  const month = useMemo(() => buildMonth(system, anchor), [system, anchor]);

  function go(dir: 1 | -1) {
    setAnchor(stepAnchor(system, anchor, dir));
  }

  function selectCell(adKey: string) {
    onChange(adKey);
    setOpen(false);
  }

  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const displayValue = value ? formatAdDate(value, system) : '';

  return (
    <>
      <TouchableOpacity style={styles.trigger} onPress={openPicker}>
        <CalendarIcon size={14} color={colors.accent} />
        <Text style={[styles.triggerText, !displayValue && { color: colors.slate400, fontWeight: '400' }]} numberOfLines={1}>
          {displayValue || placeholder}
        </Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setOpen(false)}>
          <TouchableOpacity activeOpacity={1} style={styles.sheet}>
            <View style={styles.navRow}>
              <TouchableOpacity style={styles.navBtn} onPress={() => go(-1)}>
                <Text style={styles.navBtnText}>‹</Text>
              </TouchableOpacity>
              <Text style={styles.monthLabel}>{month.label}</Text>
              <TouchableOpacity style={styles.navBtn} onPress={() => go(1)}>
                <Text style={styles.navBtnText}>›</Text>
              </TouchableOpacity>
            </View>

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
                  const isSelected = cell.adKey === value;
                  return (
                    <TouchableOpacity
                      key={ci}
                      style={[styles.cell, !cell.inMonth && { opacity: 0.3 }, isSelected && styles.cellSelected, cell.isToday && !isSelected && styles.cellToday]}
                      onPress={() => cell.inMonth && selectCell(cell.adKey)}
                      disabled={!cell.inMonth}
                    >
                      <Text style={[styles.cellText, isSelected && styles.cellTextSelected, cell.isToday && !isSelected && styles.cellTextToday]}>{cell.displayDay}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}

            <View style={styles.footer}>
              <Text style={styles.footerText}>Today: {formatAdDate(todayIso, system)}</Text>
              <TouchableOpacity onPress={() => selectCell(todayIso)}>
                <Text style={styles.footerLink}>Select today</Text>
              </TouchableOpacity>
            </View>
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
  navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  navBtn: { borderWidth: 1, borderColor: colors.slate200, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 5 },
  navBtnText: { fontSize: 14, color: colors.slate500 },
  monthLabel: { fontSize: 15, fontWeight: '700', color: colors.ink },
  weekdayRow: { flexDirection: 'row' },
  weekdayLabel: { flex: 1, textAlign: 'center', fontSize: 10, fontWeight: '600', color: colors.slate400 },
  weekRow: { flexDirection: 'row', marginTop: 4 },
  cell: { flex: 1, aspectRatio: 1, minHeight: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 999 },
  cellSelected: { backgroundColor: colors.accent },
  cellToday: { backgroundColor: colors.accentLight },
  cellText: { fontSize: 13, color: colors.slate500 },
  cellTextSelected: { color: colors.white, fontWeight: '700' },
  cellTextToday: { color: colors.accent, fontWeight: '700' },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.slate100 },
  footerText: { fontSize: 11, color: colors.slate400 },
  footerLink: { fontSize: 11, fontWeight: '600', color: colors.accent },
});
