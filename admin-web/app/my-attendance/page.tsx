'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import EmployeeShell from '@/components/EmployeeShell';
import type { AttendanceLog } from '@/lib/types';

export default function MyAttendancePage() {
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: profile } = await supabase
        .from('profiles')
        .select('employee_id')
        .eq('id', data.user.id)
        .single();
      if (!profile?.employee_id) {
        setLoading(false);
        return;
      }
      const { data: rows } = await supabase
        .from('attendance_logs')
        .select('*')
        .eq('employee_id', profile.employee_id)
        .order('punch_time', { ascending: false })
        .limit(50);
      setLogs(rows ?? []);
      setLoading(false);
    });
  }, []);

  return (
    <EmployeeShell title="My Attendance">
      {loading ? (
        <p className="text-center text-sm text-slate-400">Loading…</p>
      ) : logs.length === 0 ? (
        <p className="mt-10 text-center text-sm text-slate-400">No attendance records yet.</p>
      ) : (
        <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {logs.map(log => (
            <div key={log.id} className="flex items-center gap-3 px-4 py-3">
              <span
                className={`w-12 shrink-0 rounded-md px-2 py-1 text-center text-xs font-bold ${
                  log.punch_type === '0' ? 'bg-good-bg text-good-text' : 'bg-warning-bg text-warning-text'
                }`}
              >
                {log.punch_type === '0' ? 'IN' : 'OUT'}
              </span>
              <div className="flex-1">
                <div className="text-sm text-ink">{new Date(log.punch_time).toLocaleString()}</div>
                <div className="text-xs capitalize text-slate-400">{log.method}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </EmployeeShell>
  );
}
