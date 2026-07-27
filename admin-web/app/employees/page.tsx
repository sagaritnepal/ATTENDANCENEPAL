'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import AppShell from '@/components/AppShell';
import Badge from '@/components/Badge';
import type { Employee, Shift } from '@/lib/types';
import { resolveShift, formatShiftHours } from '@/lib/shift';

const PAGE_SIZE = 8;

const EMPTY_FORM = {
  employee_code: '',
  name: '',
  email: '',
  department: '',
  designation: '',
  fingerprint_id: '',
};

const CSV_COLUMNS = ['employee_code', 'name', 'email', 'department', 'designation', 'fingerprint_id'] as const;

// Minimal CSV parser: handles quoted fields ("a,b") and escaped quotes (""),
// which covers what a spreadsheet export actually produces — no need for a
// dependency for a 6-column import.
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

  function reload() {
    supabase.from('employees').select('*').order('created_at', { ascending: false }).then(({ data }) => setEmployees(data ?? []));
    supabase.from('shifts').select('*').then(({ data }) => setShifts(data ?? []));
  }

  useEffect(reload, []);

  const departments = useMemo(
    () => Array.from(new Set(employees.map(e => e.department).filter(Boolean))) as string[],
    [employees]
  );

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
      department: form.department || null,
      designation: form.designation || null,
      fingerprint_id: form.fingerprint_id || null,
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

  async function handleDelete(id: string) {
    if (!confirm('Remove this employee?')) return;
    await supabase.from('employees').delete().eq('id', id);
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
        CSV columns: employee_code, name, email, department, designation, fingerprint_id (header row optional).
      </p>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <th className="px-5 py-3 font-medium">Employee</th>
              <th className="px-5 py-3 font-medium">Biometric ID</th>
              <th className="px-5 py-3 font-medium">Department</th>
              <th className="px-5 py-3 font-medium">Designation</th>
              <th className="px-5 py-3 font-medium">Shift</th>
              <th className="px-5 py-3 font-medium">Bio Enrollment</th>
              <th className="px-5 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {pageItems.map(emp => {
              const shift = resolveShift(emp, shifts);
              return (
                <tr key={emp.id} className="border-b border-slate-100 last:border-0">
                  <td className="flex items-center gap-3 px-5 py-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/10 text-xs font-semibold text-accent">
                      {emp.name.slice(0, 1)}
                    </div>
                    <span className="font-medium text-ink">{emp.name}</span>
                  </td>
                  <td className="px-5 py-3 text-slate-600">{emp.fingerprint_id ?? '—'}</td>
                  <td className="px-5 py-3 text-slate-600">{emp.department ?? '—'}</td>
                  <td className="px-5 py-3 text-slate-600">{emp.designation ?? '—'}</td>
                  <td className="px-5 py-3 text-slate-600">{formatShiftHours(shift)}</td>
                  <td className="px-5 py-3">
                    <Badge tone={emp.fingerprint_id ? 'good' : 'warning'}>
                      {emp.fingerprint_id ? 'Registered' : 'Pending'}
                    </Badge>
                  </td>
                  <td className="px-5 py-3">
                    <button onClick={() => handleDelete(emp.id)} className="text-xs font-medium text-critical hover:underline">
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
            {pageItems.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-8 text-center text-slate-400">
                  No employees match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>

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
    </AppShell>
  );
}
