'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useConfirm } from '@/components/ConfirmDialog';
import type { RosterMode } from '@/lib/weekOff';

const MODE_COPY: Record<RosterMode, { label: string; confirm: string }> = {
  weekly: {
    label: 'Recurring Weekly',
    confirm:
      'Switch to a recurring weekly pattern? Every employee will follow the same Sun–Sat shift pattern every week from now on, ' +
      'driven by the Weekly Roster tab instead of exact dates. The Monthly Roster grid is kept, not deleted — switching back ' +
      'to Exact Dates restores it.',
  },
  monthly: {
    label: 'Exact Dates',
    confirm:
      'Switch to exact monthly dates? Shifts will be driven by the specific dates filled in on the Weekly/Monthly Roster ' +
      'grids instead of a repeating pattern. The recurring weekly pattern is kept, not deleted — switching back to Recurring ' +
      'Weekly restores it.',
  },
};

/** Pill toggle for companies.roster_mode — a single company-wide setting
 * that decides which of two independent data models actually drives real
 * attendance/payroll shift resolution (see the Weekly/Monthly mutual-
 * exclusion design in resolveShiftForDate(), lib/shift.ts). Deliberately
 * NOT labeled "Weekly"/"Monthly" like the page's own tabs just above it —
 * those are a UI view, this is a company-wide data-model flag, and reusing
 * the same two words for both made them easy to conflate. Shown on all
 * three roster grids so any of them can flip it, with a confirm step since
 * one click here changes what every other admin sees. Writes straight to
 * the database (there's nothing to stage) and calls onChange so every open
 * tab agrees without a full page reload. */
export default function RosterModeSwitch({
  companyId,
  mode,
  onChange,
}: {
  companyId: string | null;
  mode: RosterMode;
  onChange: (mode: RosterMode) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = useConfirm();

  async function setMode(next: RosterMode) {
    if (next === mode || saving || !companyId) return;
    if (!(await confirm(MODE_COPY[next].confirm, { title: 'Switch roster type?', confirmLabel: 'Switch' }))) return;
    setSaving(true);
    setError(null);
    const { error } = await supabase.from('companies').update({ roster_mode: next }).eq('id', companyId);
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    onChange(next);
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-medium text-slate-400">Roster type:</span>
      <div className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 text-xs font-semibold shadow-sm">
        {(Object.keys(MODE_COPY) as RosterMode[]).map(key => (
          <button
            key={key}
            type="button"
            onClick={() => setMode(key)}
            disabled={saving}
            title={MODE_COPY[key].confirm}
            className={`rounded-md px-2.5 py-1 transition-colors disabled:opacity-60 ${
              mode === key ? 'bg-good text-white' : 'text-slate-500 hover:bg-slate-50'
            }`}
          >
            {MODE_COPY[key].label} {mode === key ? '● Active' : ''}
          </button>
        ))}
      </div>
      {error && <span className="text-xs text-critical">Could not switch: {error}</span>}
    </div>
  );
}
