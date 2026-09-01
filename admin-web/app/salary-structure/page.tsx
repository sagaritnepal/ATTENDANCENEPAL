'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import AppShell from '@/components/AppShell';
import Avatar from '@/components/Avatar';
import TableExportBar, { downloadExcel } from '@/components/TableExportBar';
import { fetchMyCompanyWeekOffConfig } from '@/lib/weekOff';
import type { Employee } from '@/lib/types';

/** One company-wide rate each (companies.pf_rate/ssf_rate/tds_rate) — a
 * percentage of Basic Salary. Basic + Allowance are per employee (Basic on
 * the Payroll page, Allowance on the employee detail page). This page is the
 * one place the three rates are set; the Payroll report only reads them. */
export default function SalaryStructurePage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [companyId, setCompanyId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  // Saved rates (what's in the DB) vs the draft strings the header inputs
  // edit. The table previews with the draft so editing recalculates live;
  // "Save rates" persists and clears the dirty state.
  const [savedRates, setSavedRates] = useState({ pf: 10, ssf: 11, tds: 0 });
  const [pfDraft, setPfDraft] = useState('10');
  const [ssfDraft, setSsfDraft] = useState('11');
  const [tdsDraft, setTdsDraft] = useState('0');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', data.user.id).single();
      setIsAdmin(profile?.role === 'admin');
    });

    fetchMyCompanyWeekOffConfig().then(({ companyId, pfRate, ssfRate, tdsRate }) => {
      setCompanyId(companyId);
      setSavedRates({ pf: pfRate, ssf: ssfRate, tds: tdsRate });
      setPfDraft(String(pfRate));
      setSsfDraft(String(ssfRate));
      setTdsDraft(String(tdsRate));
    });

    supabase
      .from('employees')
      .select('*')
      .eq('status', 'active')
      .then(({ data }) => {
        setEmployees((data ?? []).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })));
        setLoading(false);
      });
  }, []);

  const pf = Number(pfDraft) || 0;
  const ssf = Number(ssfDraft) || 0;
  const tds = Number(tdsDraft) || 0;

  const dirty =
    pfDraft !== String(savedRates.pf) || ssfDraft !== String(savedRates.ssf) || tdsDraft !== String(savedRates.tds);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return employees
      .filter(e =>
        !term
          ? true
          : [e.name, e.designation, e.employee_code].filter(Boolean).some(v => (v as string).toLowerCase().includes(term))
      )
      .map(e => {
        const basic = e.salary;
        const allowance = e.allowance ?? 0;
        if (basic == null) {
          return { e, basic: null as number | null, allowance, gross: null, pfAmt: null, ssfAmt: null, tdsAmt: null, net: null };
        }
        const pfAmt = Math.round((basic * pf) / 100);
        const ssfAmt = Math.round((basic * ssf) / 100);
        const tdsAmt = Math.round((basic * tds) / 100);
        const gross = basic + allowance;
        return { e, basic, allowance, gross, pfAmt, ssfAmt, tdsAmt, net: gross - pfAmt - ssfAmt - tdsAmt };
      });
  }, [employees, search, pf, ssf, tds]);

  const totals = useMemo(() => {
    let basic = 0,
      allowance = 0,
      gross = 0,
      pfAmt = 0,
      ssfAmt = 0,
      tdsAmt = 0,
      net = 0,
      counted = 0;
    for (const r of rows) {
      if (r.basic == null) continue;
      counted++;
      basic += r.basic;
      allowance += r.allowance;
      gross += r.gross!;
      pfAmt += r.pfAmt!;
      ssfAmt += r.ssfAmt!;
      tdsAmt += r.tdsAmt!;
      net += r.net!;
    }
    return { basic, allowance, gross, pfAmt, ssfAmt, tdsAmt, net, counted, deductions: pfAmt + ssfAmt + tdsAmt };
  }, [rows]);

  async function saveRates() {
    if (!companyId) return;
    setSaving(true);
    const { error } = await supabase
      .from('companies')
      .update({ pf_rate: pf, ssf_rate: ssf, tds_rate: tds })
      .eq('id', companyId);
    setSaving(false);
    if (error) {
      alert(`Could not save the rates: ${error.message}`);
      return;
    }
    setSavedRates({ pf, ssf, tds });
  }

  function cancelRates() {
    setPfDraft(String(savedRates.pf));
    setSsfDraft(String(savedRates.ssf));
    setTdsDraft(String(savedRates.tds));
  }

  function exportCsv() {
    const header = ['Employee', 'Designation', 'Basic', 'Allowance', 'Gross', `PF (${pf}%)`, `SSF (${ssf}%)`, `TDS (${tds}%)`, 'Net Payable'];
    const lines = rows.map(r => [
      r.e.name,
      r.e.designation ?? '',
      r.basic ?? '',
      r.allowance || '',
      r.gross ?? '',
      r.pfAmt ?? '',
      r.ssfAmt ?? '',
      r.tdsAmt ?? '',
      r.net ?? '',
    ]);
    downloadExcel('salary_structure.csv', header, lines);
  }

  // Plain function returning JSX, not a nested component — a `<RateHeader/>`
  // component type would get a fresh identity each render and remount its
  // input, dropping focus mid-type.
  const rateHeader = (label: string, value: string, onChange: (v: string) => void) => (
    <div className="flex flex-col items-end gap-1">
      <span>{label}</span>
      <span className="flex items-center gap-1 normal-case tracking-normal">
        <input
          type="number"
          min="0"
          step="0.01"
          value={value}
          disabled={!isAdmin}
          onChange={e => onChange(e.target.value)}
          className="w-14 rounded-md border border-slate-200 px-1.5 py-1 text-right text-xs font-bold text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:bg-slate-50 disabled:text-slate-400"
        />
        <span className="text-[10px] font-medium text-slate-400">% of basic</span>
      </span>
    </div>
  );

  return (
    <AppShell title="Salary Structure">
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3 print:hidden">
        <div className="rounded-xl bg-info-bg p-3 shadow-sm ring-1 ring-inset ring-info/10">
          <span className="text-xs font-medium text-info-text/80">Total Gross Payroll</span>
          <div className="mt-1 text-base font-bold text-info-text">{totals.gross.toLocaleString()}</div>
          <div className="mt-0.5 text-[11px] text-info-text/70">Basic {totals.basic.toLocaleString()} · Allowance {totals.allowance.toLocaleString()}</div>
        </div>
        <div className="rounded-xl bg-critical-bg p-3 shadow-sm ring-1 ring-inset ring-critical/10">
          <span className="text-xs font-medium text-critical-text/80">Total Deductions</span>
          <div className="mt-1 text-base font-bold text-critical-text">{totals.deductions.toLocaleString()}</div>
          <div className="mt-0.5 text-[11px] text-critical-text/70">
            PF {totals.pfAmt.toLocaleString()} · SSF {totals.ssfAmt.toLocaleString()} · TDS {totals.tdsAmt.toLocaleString()}
          </div>
        </div>
        <div className="rounded-xl bg-good-bg p-3 shadow-sm ring-1 ring-inset ring-good/10">
          <span className="text-xs font-medium text-good-text/80">Total Net Payable</span>
          <div className="mt-1 text-base font-bold text-good-text">{totals.net.toLocaleString()}</div>
          <div className="mt-0.5 text-[11px] text-good-text/70">Across {totals.counted} staff on a salary</div>
        </div>
      </div>

      {dirty && isAdmin && (
        <div className="mb-3 flex items-center justify-between rounded-xl border border-accent/30 bg-accent/5 px-4 py-2.5 print:hidden">
          <span className="text-sm font-medium text-ink">Unsaved contribution-rate changes</span>
          <div className="flex gap-2">
            <button
              onClick={cancelRates}
              disabled={saving}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              onClick={saveRates}
              disabled={saving}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent/90 disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save rates'}
            </button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm print:border-0 print:shadow-none">
        <div className="flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-accent/10 via-accent/5 to-transparent px-4 py-4 sm:px-6 print:hidden">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-white">
              <StructureIcon className="h-5 w-5" />
            </span>
            <h2 className="text-lg font-bold text-ink">Monthly Salary Structure</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search staff…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-48 rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-ink shadow-sm placeholder:text-slate-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
            </div>
            <TableExportBar onExportCsv={exportCsv} />
          </div>
        </div>

        {!isAdmin && (
          <p className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs text-slate-500 sm:px-6 print:hidden">
            The PF / SSF / TDS rates are read-only for your role — an admin sets them here.
          </p>
        )}

        <h1 className="hidden px-4 pt-4 text-lg font-bold text-ink print:block sm:px-6">Monthly Salary Structure</h1>

        <div className="max-h-[65vh] overflow-auto print:max-h-none print:overflow-visible">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="sticky top-0 z-10 border-y border-slate-200 bg-slate-50 align-bottom text-xs uppercase tracking-wide text-slate-500">
                <th className="whitespace-nowrap px-3 py-2 font-medium">Employee</th>
                <th className="whitespace-nowrap px-3 py-2 font-medium">Designation</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">Basic</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">Allowance</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">Gross</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium text-critical-text">
                  {rateHeader('PF', pfDraft, setPfDraft)}
                </th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium text-critical-text">
                  {rateHeader('SSF', ssfDraft, setSsfDraft)}
                </th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium text-critical-text">
                  {rateHeader('TDS', tdsDraft, setTdsDraft)}
                </th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">Net Payable</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ e, basic, allowance, gross, pfAmt, ssfAmt, tdsAmt, net }) => (
                <tr key={e.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="whitespace-nowrap px-3 py-2 font-medium text-ink">
                    <span className="flex items-center gap-2.5">
                      <Avatar name={e.name} photoUrl={e.profile_photo_url} />
                      {e.name}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-500">{e.designation || '—'}</td>
                  {basic == null ? (
                    <td className="px-3 py-2 text-slate-400" colSpan={7}>
                      No Basic Salary set — add it on the Payroll page
                    </td>
                  ) : (
                    <>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-slate-600">{basic.toLocaleString()}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-slate-600">{allowance.toLocaleString()}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums text-ink">{gross!.toLocaleString()}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-critical-text">{pfAmt!.toLocaleString()}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-critical-text">{ssfAmt!.toLocaleString()}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-critical-text">{tdsAmt!.toLocaleString()}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-bold tabular-nums text-good-text">{net!.toLocaleString()}</td>
                    </>
                  )}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-400">
                    {loading ? 'Loading…' : 'No active employees.'}
                  </td>
                </tr>
              )}
            </tbody>
            {totals.counted > 0 && (
              <tfoot>
                <tr className="sticky bottom-0 border-t-2 border-slate-200 bg-slate-50 text-sm font-bold text-ink">
                  <td colSpan={2} className="whitespace-nowrap px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Total · {totals.counted} staff
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{totals.basic.toLocaleString()}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{totals.allowance.toLocaleString()}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{totals.gross.toLocaleString()}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{totals.pfAmt.toLocaleString()}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{totals.ssfAmt.toLocaleString()}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{totals.tdsAmt.toLocaleString()}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-good-text">{totals.net.toLocaleString()}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <p className="mt-3 text-xs text-slate-400">
        Net Payable = Basic + Allowance − PF − SSF − TDS. The three rates are company-wide; the monthly Payroll report reads
        these figures and is not edited here. Overtime, where earned, is added on top on the Payroll report.
      </p>
    </AppShell>
  );
}

function StructureIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 9h18M9 9v11" />
    </svg>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <circle cx="11" cy="11" r="7" />
      <path strokeLinecap="round" d="m20 20-3.5-3.5" />
    </svg>
  );
}
