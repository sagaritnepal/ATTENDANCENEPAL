'use client';

import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { bucketHours, referenceHours, referenceLabel, type Granularity } from '@/lib/taskHours';
import type { TaskTimeLog } from '@/lib/types';

const OPTIONS: { value: Granularity; label: string }[] = [
  { value: 'day', label: 'Daily' },
  { value: 'week', label: 'Weekly' },
  { value: 'month', label: 'Monthly' },
];

export default function TaskHoursChart({ logs }: { logs: TaskTimeLog[] }) {
  const [granularity, setGranularity] = useState<Granularity>('day');
  const data = useMemo(() => bucketHours(logs, granularity), [logs, granularity]);
  const target = referenceHours(granularity);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">Hours Worked</h2>
        <select
          value={granularity}
          onChange={e => setGranularity(e.target.value as Granularity)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600"
        >
          {OPTIONS.map(o => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="#e2e8f0" />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={{ stroke: '#e2e8f0' }} tickLine={false} />
          <YAxis tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip
            contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }}
            formatter={(v: number) => [`${v} hrs`, 'Worked']}
          />
          <ReferenceLine
            y={target}
            stroke="#94a3b8"
            strokeDasharray="4 4"
            label={{ value: referenceLabel(granularity), position: 'insideTopRight', fontSize: 11, fill: '#94a3b8' }}
          />
          <Bar dataKey="hours" name="Hours worked" fill="#0d9488" radius={[4, 4, 0, 0]} maxBarSize={32} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
