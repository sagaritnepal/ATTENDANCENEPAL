'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { LeaderboardRow } from '@/lib/types';

const MEDALS = ['🥇', '🥈', '🥉'];

export default function Leaderboard({ highlightEmployeeId }: { highlightEmployeeId?: string }) {
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.rpc('get_leaderboard').then(({ data }) => {
      setRows((data as LeaderboardRow[]) ?? []);
      setLoading(false);
    });
  }, []);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-ink">Leaderboard</h2>
      {loading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-400">No points earned yet.</p>
      ) : (
        <div className="divide-y divide-slate-100">
          {rows.map((row, i) => {
            const isSelf = row.employee_id === highlightEmployeeId;
            return (
              <div
                key={row.employee_id}
                className={`flex items-center gap-3 py-2.5 ${isSelf ? 'rounded-lg bg-accent/5 px-2' : ''}`}
              >
                <span className="w-6 shrink-0 text-center text-sm font-semibold text-slate-400">
                  {MEDALS[i] ?? i + 1}
                </span>
                <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent/10 text-xs font-semibold text-accent">
                  {row.profile_photo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={row.profile_photo_url} alt={row.name} className="h-full w-full object-cover" />
                  ) : (
                    row.name.slice(0, 1)
                  )}
                </div>
                <div className="flex-1">
                  <div className={`text-sm ${isSelf ? 'font-semibold text-accent' : 'font-medium text-ink'}`}>
                    {row.name}
                    {isSelf && ' (you)'}
                  </div>
                  <div className="text-xs text-slate-400">
                    {row.department ?? '—'} · {row.tasks_completed} task{row.tasks_completed === 1 ? '' : 's'} done
                  </div>
                </div>
                <div className="text-sm font-bold text-ink">{row.total_points} pts</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
