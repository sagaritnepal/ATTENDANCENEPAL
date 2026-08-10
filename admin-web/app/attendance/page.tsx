'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import AppShell from '@/components/AppShell';
import AttendanceReportTable from '@/components/AttendanceReportTable';

export default function AttendancePage() {
  return (
    <Suspense fallback={null}>
      <AttendanceView />
    </Suspense>
  );
}

function AttendanceView() {
  const searchParams = useSearchParams();
  const initialEmployeeId = searchParams.get('employee');
  return (
    <AppShell title="Attendance Report">
      <AttendanceReportTable initialEmployeeId={initialEmployeeId} />
    </AppShell>
  );
}
