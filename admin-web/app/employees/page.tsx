'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import AppShell from '@/components/AppShell';
import Badge from '@/components/Badge';
import type { Employee, Shift, Profile, Branch } from '@/lib/types';
import { resolveShift, formatShiftHours } from '@/lib/shift';

const PAGE_SIZE = 8;

const EMPTY_FORM = {
  employee_code: '',
  name: '',
  email: '',
  phone: '',
  department: '',
  designation: '',
  fingerprint_id: '',
  branch_id: '',
  date_of_joining: '',
};

const CSV_COLUMNS = ['employee_code', 'name', 'email', 'phone', 'department', 'designation', 'fingerprint_id'] as const;

const PASSWORD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
function generatePassword(length = 10) {
  let out = '';
  for (let i = 0; i < length; i++) out += PASSWORD_CHARS[Math.floor(Math.random() * PASSWORD_CHARS.length)];
  return out;
}

// Minimal CSV parser: handles quoted fields ("a,b") and escaped quotes (""),
// which covers what a spreadsheet export actually produces — no need for a
// dependency for a 7-column import.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some(v => v.trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    if (row.some(v => v.trim() !== '')) rows.push(row);
  }
  return rows;
}

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [filter, setFilter] = useState('All');
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ inserted: number; failed: { row: number; error: string }[] } | null>(
    null
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Per-row photo upload uses one shared hidden <input>, remembering which
  // employee it was opened for.
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [photoTargetId, setPhotoTargetId] = useState<string | null>(null);
  const [uploadingPhotoId, setUploadingPhotoId] = useState<string | null>(null);

  // Branch/Shift edits are staged here rather than saved immediately on
  // change — a Save/Cancel bar appears above the table once anything's
  // pending, so a stray click on a dropdown can't silently write to the
  // database.
  const [pendingBranch, setPendingBranch] = useState<Record<string, string>>({});
  const [pendingShift, setPendingShift] = useState<Record<string, string>>({});
  const [savingPending, setSavingPending] = useState(false);

  const [loginModalEmployee, setLoginModalEmployee] = useState<Employee | null>(null);
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [creatingLogin, setCreatingLogin] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginResult, setLoginResult] = useState<{ email: string; password: string } | null>(null);

  const [resetModalEmployee, setResetModalEmployee] = useState<Employee | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resettingPassword, setResettingPassword] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetResult, setResetResult] = useState<string | null>(null);

  function reload() {
    supabase.from('employees').select('*').order('created_at', { ascending: false }).then(({ data }) => setEmployees(data ?? []));
    supabase.from('shifts').select('*').then(({ data }) => setShifts(data ?? []));
    supabase.from('profiles').select('id, employee_id, role').then(({ data }) => setProfiles(data ?? []));
    supabase.from('branches').select('*').order('name').then(({ data }) => setBranches(data ?? []));
  }

  useEffect(reload, []);

  const departments = useMemo(
    () => Array.from(new Set(employees.map(e => e.department).filter(Boolean))) as string[],
    [employees]
  );

  const linkedEmployeeIds = useMemo(
    () => new Set(profiles.map(p => p.employee_id).filter((id): id is string => Boolean(id))),
    [profiles]
  );

  const templateShifts = useMemo(() => shifts.filter(s => s.employee_id === null), [shifts]);

  const filtered = useMemo(() => {
    if (filter === 'All') return employees;
    if (filter === 'Unenrolled') return employees.filter(e => !e.fingerprint_id);
    return employees.filter(e => e.department === filter);
  }, [employees, filter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  async function handleAddEmployee(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSaving(true);
    const { error } = await supabase.from('employees').insert({
      employee_code: form.employee_code,
      name: form.name,
      email: form.email || null,
      phone: form.phone || null,
      department: form.department || null,
      designation: form.designation || null,
      fingerprint_id: form.fingerprint_id || null,
      branch_id: form.branch_id || null,
      date_of_joining: form.date_of_joining || null,
      status: 'active',
    });
    setSaving(false);
    if (error) {
      setFormError(error.message);
      return;
    }
    setForm(EMPTY_FORM);
    setShowForm(false);
    reload();
  }

  async function applyBranchChange(employeeId: string, branchId: string) {
    const { error } = await supabase.from('employees').update({ branch_id: branchId || null }).eq('id', employeeId);
    return error;
  }

  async function handleDelete(id: string) {
    if (!confirm('Remove this employee?')) return;
    const { error } = await supabase.from('employees').delete().eq('id', id);
    if (error) {
      if (error.code === '23503') {
        alert(
          'Could not remove: this employee already has attendance, tasks, shifts, leave, or other records tied to them, ' +
            'so deleting would break that history. Use "Mark Resigned" instead — it keeps their history but removes them ' +
            'from active views.'
        );
      } else {
        alert(`Could not remove: ${error.message}`);
      }
      return;
    }
    reload();
  }

  async function handleMarkResigned(emp: Employee) {
    if (!confirm(`Mark ${emp.name} as resigned? They'll be removed from active views but their history is kept.`)) return;
    const { error } = await supabase
      .from('employees')
      .update({ status: 'inactive', resigned_at: new Date().toISOString().slice(0, 10) })
      .eq('id', emp.id);
    if (error) alert(`Could not update: ${error.message}`);
    reload();
  }

  async function handleCsvSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file next time
    if (!file) return;

    const text = await file.text();
    const rows = parseCsv(text);
    if (rows.length === 0) return;

    const header = rows[0].map(h => h.trim().toLowerCase());
    const dataRows = header[0] === 'employee_code' ? rows.slice(1) : rows;

    setImporting(true);
    setImportResult(null);
    const failed: { row: number; error: string }[] = [];
    let inserted = 0;

    for (let i = 0; i < dataRows.length; i++) {
      const cols = dataRows[i];
      const record: Record<string, string | null> = {};
      CSV_COLUMNS.forEach((col, idx) => {
        const value = cols[idx]?.trim();
        record[col] = value || null;
      });
      if (!record.employee_code || !record.name) {
        failed.push({ row: i + 2, error: 'employee_code and name are required' });
        continue;
      }
      const { error } = await supabase.from('employees').insert({ ...record, status: 'active' });
      if (error) failed.push({ row: i + 2, error: error.message });
      else inserted++;
    }

    setImporting(false);
    setImportResult({ inserted, failed });
    reload();
  }

  function openPhotoPicker(employeeId: string) {
    setPhotoTargetId(employeeId);
    photoInputRef.current?.click();
  }

  async function handlePhotoSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const employeeId = photoTargetId;
    e.target.value = '';
    if (!file || !employeeId) return;

    setUploadingPhotoId(employeeId);
    const ext = file.name.split('.').pop() || 'jpg';
    const path = `employee-photos/${employeeId}-${Date.now()}.${ext}`;
    const { error: uploadError } = await supabase.storage.from('attendance-selfies').upload(path, file, {
      contentType: file.type || 'image/jpeg',
    });
    if (uploadError) {
      setUploadingPhotoId(null);
      alert(`Photo upload failed: ${uploadError.message}`);
      return;
    }
    const { data: publicUrl } = supabase.storage.from('attendance-selfies').getPublicUrl(path);
    await supabase.from('employees').update({ profile_photo_url: publicUrl.publicUrl }).eq('id', employeeId);
    setUploadingPhotoId(null);
    reload();
  }

  // Shift *templates* are designed on the Shifts page; here we only pick
  // which template (if any) applies to this one employee — an upsert into
  // the same employee-scoped shifts row the old "Assign shift" modal used.
  async function applyShiftChange(employeeId: string, templateId: string) {
    if (!templateId) {
      const { error } = await supabase.from('shifts').delete().eq('employee_id', employeeId);
      return error;
    }
    const template = templateShifts.find(t => t.id === templateId);
    if (!template) return null;
    const { error } = await supabase.from('shifts').upsert(
      {
        employee_id: employeeId,
        name: template.name,
        type: template.type,
        start_time: template.start_time,
        end_time: template.end_time,
        grace_minutes: template.grace_minutes,
        department: null,
      },
      { onConflict: 'employee_id' }
    );
    return error;
  }

  const pendingCount = Object.keys(pendingBranch).length + Object.keys(pendingShift).length;

  function handleCancelPending() {
    setPendingBranch({});
    setPendingShift({});
  }

  async function handleSavePending() {
    setSavingPending(true);
    const errors: string[] = [];
    for (const [employeeId, branchId] of Object.entries(pendingBranch)) {
      const error = await applyBranchChange(employeeId, branchId);
      if (error) errors.push(`Branch: ${error.message}`);
    }
    for (const [employeeId, templateId] of Object.entries(pendingShift)) {
      const error = await applyShiftChange(employeeId, templateId);
      if (error) errors.push(`Shift: ${error.message}`);
    }
    setSavingPending(false);
    setPendingBranch({});
    setPendingShift({});
    if (errors.length > 0) alert(`Some changes could not be saved:\n${errors.join('\n')}`);
    reload();
  }

  function openLoginModal(emp: Employee) {
    setLoginForm({ email: emp.email ?? '', password: generatePassword() });
    setLoginError(null);
    setLoginResult(null);
    setLoginModalEmployee(emp);
  }

  async function handleCreateLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!loginModalEmployee) return;
    setCreatingLogin(true);
    setLoginError(null);
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      setCreatingLogin(false);
      setLoginError('Your session expired — please sign in again.');
      return;
    }
    const res = await fetch('/api/create-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ employeeId: loginModalEmployee.id, email: loginForm.email, password: loginForm.password }),
    });
    const body = await res.json().catch(() => ({}));
    setCreatingLogin(false);
    if (!res.ok) {
      setLoginError(body.error ?? 'Could not create the login.');
      return;
    }
    setLoginResult({ email: loginForm.email, password: loginForm.password });
    reload();
  }

  function openResetModal(emp: Employee) {
    setResetPassword(generatePassword());
    setResetError(null);
    setResetResult(null);
    setResetModalEmployee(emp);
  }

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!resetModalEmployee) return;
    setResettingPassword(true);
    setResetError(null);
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      setResettingPassword(false);
      setResetError('Your session expired — please sign in again.');
      return;
    }
    const res = await fetch('/api/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ employeeId: resetModalEmployee.id, password: resetPassword }),
    });
    const body = await res.json().catch(() => ({}));
    setResettingPassword(false);
    if (!res.ok) {
      setResetError(body.error ?? 'Could not reset the password.');
      return;
    }
    setResetResult(resetPassword);
  }

  return (
    <AppShell title="Employee Directory">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {['All', ...departments, 'Unenrolled'].map(f => (
            <button
              key={f}
              onClick={() => {
                setFilter(f);
                setPage(1);
              }}
              className={`rounded-full px-4 py-1.5 text-sm font-medium ${
                filter === f ? 'bg-accent text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
              }`}
            >
              {f === 'All' ? 'All Departments' : f === 'Unenrolled' ? 'Biometric Unenrolled' : f}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input ref={fileInputRef} type="file" accept=".csv" onChange={handleCsvSelected} className="hidden" />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            {importing ? 'Importing…' : '⭱ Import CSV'}
          </button>
          <button
            onClick={() => setShowForm(true)}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90"
          >
            + Add Employee
          </button>
        </div>
      </div>

      {importResult && (
        <div className="mb-5 rounded-lg border border-slate-200 bg-white p-4 text-sm">
          <p className="font-medium text-ink">
            Imported {importResult.inserted} employee{importResult.inserted === 1 ? '' : 's'}
            {importResult.failed.length > 0 && `, ${importResult.failed.length} failed`}.
          </p>
          {importResult.failed.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-critical">
              {importResult.failed.map((f, i) => (
                <li key={i}>
                  Row {f.row}: {f.error}
                </li>
              ))}
            </ul>
          )}
          <button onClick={() => setImportResult(null)} className="mt-2 text-xs text-slate-500 hover:underline">
            Dismiss
          </button>
        </div>
      )}

      <p className="mb-3 text-xs text-slate-400">
        CSV columns: employee_code, name, email, phone, department, designation, fingerprint_id (header row optional).
      </p>

      <input ref={photoInputRef} type="file" accept="image/*" onChange={handlePhotoSelected} className="hidden" />

      {pendingCount > 0 && (
        <div className="mb-3 flex items-center justify-between rounded-xl border border-accent/30 bg-accent/5 px-4 py-2.5">
          <span className="text-sm font-medium text-ink">
            {pendingCount} unsaved change{pendingCount === 1 ? '' : 's'}
          </span>
          <div className="flex gap-2">
            <button
              onClick={handleCancelPending}
              disabled={savingPending}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              onClick={handleSavePending}
              disabled={savingPending}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent/90 disabled:opacity-60"
            >
              {savingPending ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        {/* Mobile: one stacked card per employee — no side-scrolling. */}
        <div className="divide-y divide-slate-100 md:hidden">
          {pageItems.map(emp => {
            const shift = resolveShift(emp, shifts);
            const hasOwnShift = shifts.some(s => s.employee_id === emp.id);
            const deptDefaultShift = resolveShift(emp, shifts.filter(s => s.employee_id !== emp.id));
            return (
              <div key={emp.id} className="p-4">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => openPhotoPicker(emp.id)}
                    title="Upload photo"
                    className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full bg-accent/10 text-sm font-semibold text-accent"
                  >
                    {uploadingPhotoId === emp.id ? (
                      <span className="flex h-full w-full items-center justify-center">…</span>
                    ) : emp.profile_photo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={emp.profile_photo_url} alt={emp.name} className="h-full w-full object-cover" />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center">{emp.name.slice(0, 1)}</span>
                    )}
                  </button>
                  <div className="min-w-0 flex-1">
                    <Link href={`/employees/${emp.id}`} className="block truncate font-medium text-ink hover:text-accent hover:underline">
                      {emp.name}
                    </Link>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge tone={emp.fingerprint_id ? 'good' : 'warning'}>
                      {emp.fingerprint_id ? 'Registered' : 'Pending'}
                    </Badge>
                    {linkedEmployeeIds.has(emp.id) && <Badge tone="info">Login Active</Badge>}
                  </div>
                </div>

                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                  <div>
                    <dt className="text-xs text-slate-400">Biometric ID</dt>
                    <dd className="text-slate-600">{emp.fingerprint_id ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-400">Shift</dt>
                    <dd>
                      <select
                        value={
                          pendingShift[emp.id] ??
                          (hasOwnShift
                            ? templateShifts.find(
                                t => t.name === shift.name && t.start_time === shift.start_time && t.end_time === shift.end_time
                              )?.id ?? ''
                            : '')
                        }
                        onChange={e => setPendingShift(p => ({ ...p, [emp.id]: e.target.value }))}
                        className="w-full rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600"
                      >
                        <option value="">Default ({formatShiftHours(deptDefaultShift)})</option>
                        {templateShifts.map(t => (
                          <option key={t.id} value={t.id}>
                            {t.name} ({formatShiftHours(t)})
                          </option>
                        ))}
                      </select>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-400">Branch</dt>
                    <dd>
                      <select
                        value={pendingBranch[emp.id] ?? (emp.branch_id ?? '')}
                        onChange={e => setPendingBranch(p => ({ ...p, [emp.id]: e.target.value }))}
                        className={`w-full rounded-md border px-2 py-1 text-xs ${
                          (pendingBranch[emp.id] ?? emp.branch_id) ? 'border-slate-200 text-slate-600' : 'border-warning text-warning-text'
                        }`}
                      >
                        <option value="">Unassigned</option>
                        {branches.map(b => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                    </dd>
                  </div>
                </dl>

                <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3">
                  {linkedEmployeeIds.has(emp.id) ? (
                    <>
                      <span className="text-xs font-medium text-good">Login active</span>
                      <button onClick={() => openResetModal(emp)} className="text-xs font-medium text-accent hover:underline">
                        Reset password
                      </button>
                    </>
                  ) : (
                    <button onClick={() => openLoginModal(emp)} className="text-xs font-medium text-accent hover:underline">
                      Create login
                    </button>
                  )}
                  {emp.status === 'active' && (
                    <button onClick={() => handleMarkResigned(emp)} className="text-xs font-medium text-warning-text hover:underline">
                      Mark Resigned
                    </button>
                  )}
                  <button onClick={() => handleDelete(emp.id)} className="text-xs font-medium text-critical hover:underline">
                    Remove
                  </button>
                </div>
              </div>
            );
          })}
          {pageItems.length === 0 && (
            <div className="px-5 py-8 text-center text-slate-400">No employees match this filter.</div>
          )}
        </div>

        {/* Desktop: full table. */}
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-3 py-3 font-medium">Employee</th>
                <th className="px-3 py-3 font-medium">Biometric ID</th>
                <th className="px-3 py-3 font-medium">Branch</th>
                <th className="px-3 py-3 font-medium">Shift</th>
                <th className="px-3 py-3 font-medium">Bio Enrollment</th>
                <th className="px-3 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map(emp => {
                const shift = resolveShift(emp, shifts);
                const hasOwnShift = shifts.some(s => s.employee_id === emp.id);
                const deptDefaultShift = resolveShift(emp, shifts.filter(s => s.employee_id !== emp.id));
                return (
                  <tr key={emp.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openPhotoPicker(emp.id)}
                          title="Upload photo"
                          className="relative h-8 w-8 shrink-0 overflow-hidden rounded-full bg-accent/10 text-xs font-semibold text-accent"
                        >
                          {uploadingPhotoId === emp.id ? (
                            <span className="flex h-full w-full items-center justify-center">…</span>
                          ) : emp.profile_photo_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={emp.profile_photo_url} alt={emp.name} className="h-full w-full object-cover" />
                          ) : (
                            <span className="flex h-full w-full items-center justify-center">{emp.name.slice(0, 1)}</span>
                          )}
                        </button>
                        <Link href={`/employees/${emp.id}`} className="font-medium text-ink hover:text-accent hover:underline">
                          {emp.name}
                        </Link>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-slate-600">{emp.fingerprint_id ?? '—'}</td>
                    <td className="px-3 py-3">
                      <select
                        value={pendingBranch[emp.id] ?? (emp.branch_id ?? '')}
                        onChange={e => setPendingBranch(p => ({ ...p, [emp.id]: e.target.value }))}
                        className={`w-full rounded-md border px-2 py-1 text-xs ${
                          (pendingBranch[emp.id] ?? emp.branch_id) ? 'border-slate-200 text-slate-600' : 'border-warning text-warning-text'
                        }`}
                      >
                        <option value="">Unassigned</option>
                        {branches.map(b => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-3">
                      <select
                        value={
                          pendingShift[emp.id] ??
                          (hasOwnShift
                            ? templateShifts.find(
                                t => t.name === shift.name && t.start_time === shift.start_time && t.end_time === shift.end_time
                              )?.id ?? ''
                            : '')
                        }
                        onChange={e => setPendingShift(p => ({ ...p, [emp.id]: e.target.value }))}
                        className="w-full rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600"
                      >
                        <option value="">Default ({formatShiftHours(deptDefaultShift)})</option>
                        {templateShifts.map(t => (
                          <option key={t.id} value={t.id}>
                            {t.name} ({formatShiftHours(t)})
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-3">
                      <Badge tone={emp.fingerprint_id ? 'good' : 'warning'}>
                        {emp.fingerprint_id ? 'Registered' : 'Pending'}
                      </Badge>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {linkedEmployeeIds.has(emp.id) ? (
                          <>
                            <span className="text-xs font-medium text-good">Login active</span>
                            <button onClick={() => openResetModal(emp)} className="text-xs font-medium text-accent hover:underline">
                              Reset password
                            </button>
                          </>
                        ) : (
                          <button onClick={() => openLoginModal(emp)} className="text-xs font-medium text-accent hover:underline">
                            Create login
                          </button>
                        )}
                        {emp.status === 'active' && (
                          <button onClick={() => handleMarkResigned(emp)} className="text-xs font-medium text-warning-text hover:underline">
                            Mark Resigned
                          </button>
                        )}
                        <button onClick={() => handleDelete(emp.id)} className="text-xs font-medium text-critical hover:underline">
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {pageItems.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-slate-400">
                    No employees match this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-sm text-slate-500">
          <span>
            Showing {pageItems.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1} to {(page - 1) * PAGE_SIZE + pageItems.length} of{' '}
            {filtered.length} employees
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="rounded-md border border-slate-200 px-3 py-1 disabled:opacity-40"
            >
              Prev
            </button>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="rounded-md border border-slate-200 px-3 py-1 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4">
          <form onSubmit={handleAddEmployee} className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
            <h3 className="mb-4 text-lg font-semibold text-ink">Add Employee</h3>
            {(
              [
                ['employee_code', 'Employee code', true],
                ['name', 'Full name', true],
                ['email', 'Email', false],
                ['phone', 'Contact number', false],
                ['department', 'Department', false],
                ['designation', 'Designation', false],
                ['fingerprint_id', 'Fingerprint / Biometric ID', false],
              ] as const
            ).map(([key, label, required]) => (
              <div key={key} className="mb-3">
                <label className="mb-1 block text-xs font-medium text-slate-600">{label}</label>
                <input
                  required={required}
                  value={form[key]}
                  onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
                />
              </div>
            ))}
            <div className="mb-3">
              <label className="mb-1 block text-xs font-medium text-slate-600">Branch</label>
              <select
                value={form.branch_id}
                onChange={e => setForm(f => ({ ...f, branch_id: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
              >
                <option value="">Unassigned (GPS check-in won&apos;t work until set)</option>
                {branches.map(b => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="mb-3">
              <label className="mb-1 block text-xs font-medium text-slate-600">Date of joining</label>
              <input
                type="date"
                value={form.date_of_joining}
                onChange={e => setForm(f => ({ ...f, date_of_joining: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
              />
            </div>
            {formError && <p className="mb-3 text-sm text-critical">{formError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-60"
              >
                {saving ? 'Saving…' : 'Save employee'}
              </button>
            </div>
          </form>
        </div>
      )}

      {loginModalEmployee && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
            {loginResult ? (
              <>
                <h3 className="mb-1 text-lg font-semibold text-ink">Login created</h3>
                <p className="mb-4 text-xs text-slate-500">
                  Share these with {loginModalEmployee.name} so they can sign in on the mobile app. This password won&apos;t
                  be shown again.
                </p>
                <div className="mb-4 space-y-2 rounded-lg bg-slate-50 p-3 text-sm">
                  <div>
                    <span className="text-xs uppercase text-slate-400">Email</span>
                    <div className="font-medium text-ink">{loginResult.email}</div>
                  </div>
                  <div>
                    <span className="text-xs uppercase text-slate-400">Password</span>
                    <div className="font-mono font-medium text-ink">{loginResult.password}</div>
                  </div>
                </div>
                <div className="flex justify-end">
                  <button
                    onClick={() => setLoginModalEmployee(null)}
                    className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90"
                  >
                    Done
                  </button>
                </div>
              </>
            ) : (
              <form onSubmit={handleCreateLogin}>
                <h3 className="mb-1 text-lg font-semibold text-ink">Create Login</h3>
                <p className="mb-4 text-xs text-slate-500">{loginModalEmployee.name} will use this to sign in on the mobile app.</p>
                <label className="mb-1 block text-xs font-medium text-slate-600">Email</label>
                <input
                  type="email"
                  required
                  value={loginForm.email}
                  onChange={e => setLoginForm(f => ({ ...f, email: e.target.value }))}
                  className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
                />
                <label className="mb-1 block text-xs font-medium text-slate-600">Temporary password</label>
                <div className="mb-3 flex gap-2">
                  <input
                    required
                    minLength={8}
                    value={loginForm.password}
                    onChange={e => setLoginForm(f => ({ ...f, password: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent/30"
                  />
                  <button
                    type="button"
                    onClick={() => setLoginForm(f => ({ ...f, password: generatePassword() }))}
                    className="shrink-0 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
                  >
                    Regenerate
                  </button>
                </div>
                {loginError && <p className="mb-3 text-sm text-critical">{loginError}</p>}
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setLoginModalEmployee(null)}
                    className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={creatingLogin}
                    className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-60"
                  >
                    {creatingLogin ? 'Creating…' : 'Create login'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {resetModalEmployee && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
            {resetResult ? (
              <>
                <h3 className="mb-1 text-lg font-semibold text-ink">Password reset</h3>
                <p className="mb-4 text-xs text-slate-500">
                  Share this with {resetModalEmployee.name}. Their old password no longer works. This won&apos;t be shown
                  again.
                </p>
                <div className="mb-4 space-y-2 rounded-lg bg-slate-50 p-3 text-sm">
                  <div>
                    <span className="text-xs uppercase text-slate-400">New password</span>
                    <div className="font-mono font-medium text-ink">{resetResult}</div>
                  </div>
                </div>
                <div className="flex justify-end">
                  <button
                    onClick={() => setResetModalEmployee(null)}
                    className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90"
                  >
                    Done
                  </button>
                </div>
              </>
            ) : (
              <form onSubmit={handleResetPassword}>
                <h3 className="mb-1 text-lg font-semibold text-ink">Reset Password</h3>
                <p className="mb-4 text-xs text-slate-500">
                  Sets a new password for {resetModalEmployee.name}&apos;s login. Their current password stops working
                  immediately.
                </p>
                <label className="mb-1 block text-xs font-medium text-slate-600">New password</label>
                <div className="mb-3 flex gap-2">
                  <input
                    required
                    minLength={8}
                    value={resetPassword}
                    onChange={e => setResetPassword(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent/30"
                  />
                  <button
                    type="button"
                    onClick={() => setResetPassword(generatePassword())}
                    className="shrink-0 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
                  >
                    Regenerate
                  </button>
                </div>
                {resetError && <p className="mb-3 text-sm text-critical">{resetError}</p>}
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setResetModalEmployee(null)}
                    className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={resettingPassword}
                    className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-60"
                  >
                    {resettingPassword ? 'Resetting…' : 'Reset password'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </AppShell>
  );
}
