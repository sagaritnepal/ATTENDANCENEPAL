'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';

/** Self-serve per-company toggle for companies.break_enabled
 * (20260820100000_break_punches.sql) — whether employees see Start
 * Break/End Break buttons on the self-checkin screen (admin-web's
 * /checkin and mobile's CheckInScreen). Modeled on RosterModeSwitch.tsx:
 * writes straight to the database (nothing to stage) and calls onChange so
 * every open tab/screen agrees without a full reload. */
export default function BreakEnabledSwitch({
  companyId,
  enabled,
  onChange,
}: {
  companyId: string | null;
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (saving || !companyId) return;
    const next = !enabled;
    setSaving(true);
    setError(null);
    const { error } = await supabase.from('companies').update({ break_enabled: next }).eq('id', companyId);
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    onChange(next);
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-medium text-slate-400">Break punches:</span>
      <button
        type="button"
        onClick={toggle}
        disabled={saving}
        title={enabled ? 'Employees see Start Break/End Break on self-checkin' : 'Break buttons hidden on self-checkin'}
        className={`inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${
          enabled ? 'bg-good' : 'bg-slate-300'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
            enabled ? 'translate-x-[18px]' : 'translate-x-0.5'
          }`}
        />
      </button>
      <span className="text-xs font-semibold text-ink">{enabled ? 'On' : 'Off'}</span>
      {error && <span className="text-xs text-critical">Could not switch: {error}</span>}
    </div>
  );
}
