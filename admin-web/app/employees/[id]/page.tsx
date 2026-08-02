'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import AppShell from '@/components/AppShell';
import type { Branch, Employee, EmployeeEducation, EmployeeWorkExperience } from '@/lib/types';

function tenureDays(dateOfJoining: string | null, resignedAt: string | null) {
  if (!dateOfJoining) return null;
  const start = new Date(dateOfJoining).getTime();
  const end = resignedAt ? new Date(resignedAt).getTime() : Date.now();
  return Math.max(0, Math.floor((end - start) / 86400000));
}

const EMPTY_EDUCATION_FORM = { degree: '', institution: '', year: '' };
const EMPTY_EXPERIENCE_FORM = { employer: '', role: '', start_date: '', end_date: '' };
const EMPTY_EMERGENCY_FORM = { emergency_contact_name: '', emergency_contact_relationship: '', emergency_contact_phone: '' };

async function toDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export default function EmployeeCvPage() {
  const params = useParams<{ id: string }>();
  const employeeId = params.id;

  const [employee, setEmployee] = useState<Employee | null>(null);
  const [branch, setBranch] = useState<Branch | null>(null);
  const [education, setEducation] = useState<EmployeeEducation[]>([]);
  const [experience, setExperience] = useState<EmployeeWorkExperience[]>([]);
  const [loading, setLoading] = useState(true);

  const [emergencyForm, setEmergencyForm] = useState(EMPTY_EMERGENCY_FORM);
  const [savingEmergency, setSavingEmergency] = useState(false);

  const [skillInput, setSkillInput] = useState('');

  const [showEducationForm, setShowEducationForm] = useState(false);
  const [educationForm, setEducationForm] = useState(EMPTY_EDUCATION_FORM);
  const [savingEducation, setSavingEducation] = useState(false);

  const [showExperienceForm, setShowExperienceForm] = useState(false);
  const [experienceForm, setExperienceForm] = useState(EMPTY_EXPERIENCE_FORM);
  const [savingExperience, setSavingExperience] = useState(false);

  const [generatingPdf, setGeneratingPdf] = useState(false);

  function reload() {
    supabase
      .from('employees')
      .select('*')
      .eq('id', employeeId)
      .single()
      .then(({ data }) => {
        if (data) {
          setEmployee(data);
          setEmergencyForm({
            emergency_contact_name: data.emergency_contact_name ?? '',
            emergency_contact_relationship: data.emergency_contact_relationship ?? '',
            emergency_contact_phone: data.emergency_contact_phone ?? '',
          });
          if (data.branch_id) {
            supabase
              .from('branches')
              .select('*')
              .eq('id', data.branch_id)
              .single()
              .then(({ data: b }) => setBranch(b ?? null));
          } else {
            setBranch(null);
          }
        }
        setLoading(false);
      });
    supabase
      .from('employee_education')
      .select('*')
      .eq('employee_id', employeeId)
      .order('year', { ascending: false })
      .then(({ data }) => setEducation(data ?? []));
    supabase
      .from('employee_work_experience')
      .select('*')
      .eq('employee_id', employeeId)
      .order('start_date', { ascending: false })
      .then(({ data }) => setExperience(data ?? []));
  }
  useEffect(() => {
    if (employeeId) reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId]);

  async function handleSaveEmergency(e: React.FormEvent) {
    e.preventDefault();
    if (!employee) return;
    setSavingEmergency(true);
    const { error } = await supabase
      .from('employees')
      .update({
        emergency_contact_name: emergencyForm.emergency_contact_name || null,
        emergency_contact_relationship: emergencyForm.emergency_contact_relationship || null,
        emergency_contact_phone: emergencyForm.emergency_contact_phone || null,
      })
      .eq('id', employee.id);
    setSavingEmergency(false);
    if (error) {
      alert(`Could not save: ${error.message}`);
      return;
    }
    reload();
  }

  async function addSkill() {
    const skill = skillInput.trim();
    if (!skill || !employee) return;
    if (employee.skills.includes(skill)) {
      setSkillInput('');
      return;
    }
    const { error } = await supabase
      .from('employees')
      .update({ skills: [...employee.skills, skill] })
      .eq('id', employee.id);
    if (error) {
      alert(`Could not add skill: ${error.message}`);
      return;
    }
    setSkillInput('');
    reload();
  }

  async function removeSkill(skill: string) {
    if (!employee) return;
    const { error } = await supabase
      .from('employees')
      .update({ skills: employee.skills.filter(s => s !== skill) })
      .eq('id', employee.id);
    if (error) {
      alert(`Could not remove skill: ${error.message}`);
      return;
    }
    reload();
  }

  async function handleAddEducation(e: React.FormEvent) {
    e.preventDefault();
    setSavingEducation(true);
    const { error } = await supabase.from('employee_education').insert({
      employee_id: employeeId,
      degree: educationForm.degree,
      institution: educationForm.institution || null,
      year: educationForm.year ? Number(educationForm.year) : null,
    });
    setSavingEducation(false);
    if (error) {
      alert(`Could not add: ${error.message}`);
      return;
    }
    setEducationForm(EMPTY_EDUCATION_FORM);
    setShowEducationForm(false);
    reload();
  }

  async function handleDeleteEducation(id: string) {
    if (!confirm('Remove this education entry?')) return;
    await supabase.from('employee_education').delete().eq('id', id);
    reload();
  }

  async function handleAddExperience(e: React.FormEvent) {
    e.preventDefault();
    setSavingExperience(true);
    const { error } = await supabase.from('employee_work_experience').insert({
      employee_id: employeeId,
      employer: experienceForm.employer,
      role: experienceForm.role || null,
      start_date: experienceForm.start_date || null,
      end_date: experienceForm.end_date || null,
    });
    setSavingExperience(false);
    if (error) {
      alert(`Could not add: ${error.message}`);
      return;
    }
    setExperienceForm(EMPTY_EXPERIENCE_FORM);
    setShowExperienceForm(false);
    reload();
  }

  async function handleDeleteExperience(id: string) {
    if (!confirm('Remove this work experience entry?')) return;
    await supabase.from('employee_work_experience').delete().eq('id', id);
    reload();
  }

  async function downloadPdf() {
    if (!employee) return;
    setGeneratingPdf(true);
    try {
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF({ unit: 'mm', format: 'a4' });
      const marginX = 18;
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const contentWidth = pageWidth - marginX * 2;
      let y = 20;

      function ensureSpace(next: number) {
        if (y + next > pageHeight - 15) {
          doc.addPage();
          y = 20;
        }
      }

      let textStartX = marginX;
      if (employee!.profile_photo_url) {
        const dataUrl = await toDataUrl(employee!.profile_photo_url);
        if (dataUrl) {
          try {
            doc.addImage(dataUrl, 'JPEG', marginX, y, 28, 28);
            textStartX = marginX + 34;
          } catch {
            // Unsupported image format for jsPDF — fall back to text-only header.
          }
        }
      }

      doc.setFontSize(18);
      doc.setFont('helvetica', 'bold');
      doc.text(employee!.name, textStartX, y + 8);
      doc.setFontSize(11);
      doc.setFont('helvetica', 'normal');
      doc.text([employee!.designation, employee!.department].filter(Boolean).join(' · ') || '—', textStartX, y + 15);
      doc.setFontSize(9);
      doc.setTextColor(100);
      const contactLine = [employee!.phone, employee!.email, branch?.name].filter(Boolean).join('   ·   ');
      doc.text(contactLine || '—', textStartX, y + 21);
      doc.setTextColor(0);
      y += 34;

      function sectionHeading(title: string) {
        ensureSpace(10);
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text(title, marginX, y);
        y += 1.5;
        doc.setDrawColor(200);
        doc.line(marginX, y, pageWidth - marginX, y);
        y += 6;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
      }

      sectionHeading('Employment');
      const days = tenureDays(employee!.date_of_joining, employee!.resigned_at);
      const employmentLines = [
        `Employee code: ${employee!.employee_code}`,
        `Date of joining: ${employee!.date_of_joining ?? '—'}`,
        days !== null ? `Tenure: ${days} days${employee!.resigned_at ? ' (resigned ' + employee!.resigned_at + ')' : ''}` : null,
        employee!.address ? `Address: ${employee!.address}` : null,
      ].filter(Boolean) as string[];
      for (const line of employmentLines) {
        ensureSpace(6);
        doc.text(line, marginX, y);
        y += 6;
      }
      y += 4;

      if (education.length > 0) {
        sectionHeading('Education');
        for (const ed of education) {
          ensureSpace(6);
          const line = [ed.degree, ed.institution, ed.year ? String(ed.year) : null].filter(Boolean).join(' — ');
          const wrapped = doc.splitTextToSize(line, contentWidth);
          doc.text(wrapped, marginX, y);
          y += wrapped.length * 5 + 2;
        }
        y += 2;
      }

      if (experience.length > 0) {
        sectionHeading('Work Experience');
        for (const exp of experience) {
          ensureSpace(6);
          const dates = [exp.start_date, exp.end_date ?? 'Present'].filter(Boolean).join(' – ');
          const line = [exp.employer, exp.role, dates].filter(Boolean).join(' — ');
          const wrapped = doc.splitTextToSize(line, contentWidth);
          doc.text(wrapped, marginX, y);
          y += wrapped.length * 5 + 2;
        }
        y += 2;
      }

      if (employee!.skills.length > 0) {
        sectionHeading('Skills');
        const wrapped = doc.splitTextToSize(employee!.skills.join(', '), contentWidth);
        doc.text(wrapped, marginX, y);
        y += wrapped.length * 5 + 2;
      }

      if (employee!.emergency_contact_name || employee!.emergency_contact_phone) {
        sectionHeading('Emergency Contact');
        const line = [employee!.emergency_contact_name, employee!.emergency_contact_relationship, employee!.emergency_contact_phone]
          .filter(Boolean)
          .join(' — ');
        doc.text(line, marginX, y);
        y += 6;
      }

      doc.save(`${employee!.name.replace(/\s+/g, '_')}_CV.pdf`);
    } finally {
      setGeneratingPdf(false);
    }
  }

  if (loading) {
    return (
      <AppShell title="Employee CV">
        <p className="text-sm text-slate-400">Loading…</p>
      </AppShell>
    );
  }

  if (!employee) {
    return (
      <AppShell title="Employee CV">
        <p className="text-sm text-warning-text">Employee not found.</p>
      </AppShell>
    );
  }

  const days = tenureDays(employee.date_of_joining, employee.resigned_at);

  return (
    <AppShell title="Employee CV">
      <div className="mb-5 flex items-center justify-between">
        <Link href="/employees" className="text-sm font-medium text-accent hover:underline">
          {'←'} Employee Directory
        </Link>
        <div className="flex gap-2">
          <Link
            href={`/attendance?employee=${employee.id}`}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            View Attendance
          </Link>
          <button
            onClick={downloadPdf}
            disabled={generatingPdf}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-60"
          >
            {generatingPdf ? 'Generating…' : '⬇ Download PDF'}
          </button>
        </div>
      </div>

      <div className="mb-5 flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-6">
        <div className="h-20 w-20 shrink-0 overflow-hidden rounded-full bg-accent/10 text-2xl font-semibold text-accent">
          {employee.profile_photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={employee.profile_photo_url} alt={employee.name} className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center">{employee.name.slice(0, 1)}</span>
          )}
        </div>
        <div>
          <h1 className="text-lg font-semibold text-ink">{employee.name}</h1>
          <p className="text-sm text-slate-500">
            {employee.designation ?? '—'} {employee.department && `· ${employee.department}`}
          </p>
          <p className="text-xs text-slate-400">
            {[employee.phone, employee.email, branch?.name].filter(Boolean).join('  ·  ') || '—'}
          </p>
        </div>
      </div>

      <div className="mb-5 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink">Employment</h2>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <span className="block text-xs text-slate-400">Employee code</span>
            <span className="text-ink">{employee.employee_code}</span>
          </div>
          <div>
            <span className="block text-xs text-slate-400">Date of joining</span>
            <span className="text-ink">{employee.date_of_joining ?? '—'}</span>
          </div>
          <div>
            <span className="block text-xs text-slate-400">{employee.resigned_at ? 'Days worked' : 'Days with company'}</span>
            <span className="text-ink">{days !== null ? `${days} days` : '—'}</span>
          </div>
          {employee.resigned_at && (
            <div>
              <span className="block text-xs text-slate-400">Resigned</span>
              <span className="text-ink">{employee.resigned_at}</span>
            </div>
          )}
          {employee.address && (
            <div className="col-span-2">
              <span className="block text-xs text-slate-400">Address</span>
              <span className="text-ink">{employee.address}</span>
            </div>
          )}
        </div>
      </div>

      <form onSubmit={handleSaveEmergency} className="mb-5 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink">Emergency Contact</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Name</label>
            <input
              value={emergencyForm.emergency_contact_name}
              onChange={e => setEmergencyForm(f => ({ ...f, emergency_contact_name: e.target.value }))}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Relationship</label>
            <input
              value={emergencyForm.emergency_contact_relationship}
              onChange={e => setEmergencyForm(f => ({ ...f, emergency_contact_relationship: e.target.value }))}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Phone</label>
            <input
              value={emergencyForm.emergency_contact_phone}
              onChange={e => setEmergencyForm(f => ({ ...f, emergency_contact_phone: e.target.value }))}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
        </div>
        <button
          type="submit"
          disabled={savingEmergency}
          className="mt-3 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-60"
        >
          {savingEmergency ? 'Saving…' : 'Save'}
        </button>
      </form>

      <div className="mb-5 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink">Skills</h2>
        <div className="mb-3 flex flex-wrap gap-2">
          {employee.skills.map(skill => (
            <span key={skill} className="flex items-center gap-1 rounded-full bg-accent/10 px-3 py-1 text-xs font-medium text-accent">
              {skill}
              <button onClick={() => removeSkill(skill)} className="text-accent/60 hover:text-accent">
                ×
              </button>
            </span>
          ))}
          {employee.skills.length === 0 && <p className="text-xs text-slate-400">No skills added yet.</p>}
        </div>
        <div className="flex gap-2">
          <input
            value={skillInput}
            onChange={e => setSkillInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addSkill();
              }
            }}
            placeholder="Add a skill and press Enter"
            className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
          <button onClick={addSkill} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Add
          </button>
        </div>
      </div>

      <div className="mb-5 rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Education</h2>
          <button onClick={() => setShowEducationForm(true)} className="text-xs font-medium text-accent hover:underline">
            + Add
          </button>
        </div>
        {education.length === 0 && <p className="text-xs text-slate-400">No education entries yet.</p>}
        <ul className="divide-y divide-slate-100">
          {education.map(ed => (
            <li key={ed.id} className="flex items-center justify-between py-2 text-sm">
              <div>
                <span className="font-medium text-ink">{ed.degree}</span>
                {(ed.institution || ed.year) && (
                  <span className="text-slate-500"> — {[ed.institution, ed.year ? String(ed.year) : null].filter(Boolean).join(', ')}</span>
                )}
              </div>
              <button onClick={() => handleDeleteEducation(ed.id)} className="text-xs font-medium text-critical hover:underline">
                Remove
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="mb-5 rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Work Experience</h2>
          <button onClick={() => setShowExperienceForm(true)} className="text-xs font-medium text-accent hover:underline">
            + Add
          </button>
        </div>
        {experience.length === 0 && <p className="text-xs text-slate-400">No work experience entries yet.</p>}
        <ul className="divide-y divide-slate-100">
          {experience.map(exp => (
            <li key={exp.id} className="flex items-center justify-between py-2 text-sm">
              <div>
                <span className="font-medium text-ink">{exp.employer}</span>
                {exp.role && <span className="text-slate-500"> — {exp.role}</span>}
                {(exp.start_date || exp.end_date) && (
                  <span className="block text-xs text-slate-400">
                    {exp.start_date ?? '—'} {'–'} {exp.end_date ?? 'Present'}
                  </span>
                )}
              </div>
              <button onClick={() => handleDeleteExperience(exp.id)} className="text-xs font-medium text-critical hover:underline">
                Remove
              </button>
            </li>
          ))}
        </ul>
      </div>

      {showEducationForm && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4">
          <form onSubmit={handleAddEducation} className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
            <h3 className="mb-4 text-lg font-semibold text-ink">Add Education</h3>
            <label className="mb-1 block text-xs font-medium text-slate-600">Degree</label>
            <input
              required
              value={educationForm.degree}
              onChange={e => setEducationForm(f => ({ ...f, degree: e.target.value }))}
              className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <label className="mb-1 block text-xs font-medium text-slate-600">Institution</label>
            <input
              value={educationForm.institution}
              onChange={e => setEducationForm(f => ({ ...f, institution: e.target.value }))}
              className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <label className="mb-1 block text-xs font-medium text-slate-600">Year</label>
            <input
              type="number"
              value={educationForm.year}
              onChange={e => setEducationForm(f => ({ ...f, year: e.target.value }))}
              className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowEducationForm(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingEducation}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-60"
              >
                {savingEducation ? 'Saving…' : 'Add'}
              </button>
            </div>
          </form>
        </div>
      )}

      {showExperienceForm && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4">
          <form onSubmit={handleAddExperience} className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
            <h3 className="mb-4 text-lg font-semibold text-ink">Add Work Experience</h3>
            <label className="mb-1 block text-xs font-medium text-slate-600">Employer</label>
            <input
              required
              value={experienceForm.employer}
              onChange={e => setExperienceForm(f => ({ ...f, employer: e.target.value }))}
              className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <label className="mb-1 block text-xs font-medium text-slate-600">Role</label>
            <input
              value={experienceForm.role}
              onChange={e => setExperienceForm(f => ({ ...f, role: e.target.value }))}
              className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <div className="mb-3 grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Start date</label>
                <input
                  type="date"
                  value={experienceForm.start_date}
                  onChange={e => setExperienceForm(f => ({ ...f, start_date: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">End date</label>
                <input
                  type="date"
                  value={experienceForm.end_date}
                  onChange={e => setExperienceForm(f => ({ ...f, end_date: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowExperienceForm(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingExperience}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-60"
              >
                {savingExperience ? 'Saving…' : 'Add'}
              </button>
            </div>
          </form>
        </div>
      )}
    </AppShell>
  );
}
