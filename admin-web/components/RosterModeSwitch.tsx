'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { RosterMode } from '@/lib/weekOff';

/** Pill toggle for companies.roster_mode, shown on both roster tabs so
 * either one can flip the switch — see the Weekly/Monthly mutual-exclusion
 * design in resolveShiftForDate() (lib/shift.ts). Writes straight to the
 * database (there's nothing to stage) and calls onChange so both tabs'
 * headers agree without a full page reload. */
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

  async function setMode(next: RosterMode) {
    if (next === mode || saving || !companyId) return;
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
      <div className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 text-xs font-semibold shadow-sm">
        <button
          type="button"
          onClick={() => setMode('weekly')}
          disabled={saving}
          className={`rounded-md px-2.5 py-1 transition-colors disabled:opacity-60 ${
            mode === 'weekly' ? 'bg-good text-white' : 'text-slate-500 hover:bg-slate-50'
          }`}
        >
          Weekly {mode === 'weekly' ? '● Active' : ''}
        </button>
        <button
          type="button"
          onClick={() => setMode('monthly')}
          disabled={saving}
          className={`rounded-md px-2.5 py-1 transition-colors disabled:opacity-60 ${
            mode === 'monthly' ? 'bg-good text-white' : 'text-slate-500 hover:bg-slate-50'
          }`}
        >
          Monthly {mode === 'monthly' ? '● Active' : ''}
        </button>
      </div>
      {error && <span className="text-xs text-critical">Could not switch: {error}</span>}
    </div>
  );
}
