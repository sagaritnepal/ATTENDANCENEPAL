'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import EmployeeShell from '@/components/EmployeeShell';
import Badge from '@/components/Badge';
import DatePicker from '@/components/DatePicker';
import type { Employee, EmployeeEducation, EmployeeWorkExperience, LeaderboardRow, PointRedemption } from '@/lib/types';

const EMPTY_PROFILE_FORM = { name: '', email: '', phone: '', address: '', department: '', designation: '' };
const EMPTY_EMERGENCY_FORM = { emergency_contact_name: '', emergency_contact_relationship: '', emergency_contact_phone: '' };
const EMPTY_EDUCATION_FORM = { degree: '', institution: '', year: '' };
const EMPTY_EXPERIENCE_FORM = { employer: '', role: '', start_date: '', end_date: '' };

function tenureDays(dateOfJoining: string | null, resignedAt: string | null) {
  if (!dateOfJoining) return null;
  const start = new Date(dateOfJoining).getTime();
  const end = resignedAt ? new Date(resignedAt).getTime() : Date.now();
  return Math.max(0, Math.floor((end - start) / 86400000));
}

function statusTone(status: string) {
  if (status === 'approved') return 'good' as const;
  if (status === 'rejected') return 'critical' as const;
  return 'warning' as const;
}

export default function MyProfilePage() {
  const router = useRouter();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);
  const [board, setBoard] = useState<LeaderboardRow | null>(null);
  const [redemptions, setRedemptions] = useState<PointRedemption[]>([]);

  const [profileForm, setProfileForm] = useState(EMPTY_PROFILE_FORM);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const photoInputRef = useRef<HTMLInputElement>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const [showRedeem, setShowRedeem] = useState(false);
  const [redeemPoints, setRedeemPoints] = useState(0);
  const [redeemNote, setRedeemNote] = useState('');
  const [submittingRedeem, setSubmittingRedeem] = useState(false);
  const [redeemError, setRedeemError] = useState<string | null>(null);

  const [emergencyForm, setEmergencyForm] = useState(EMPTY_EMERGENCY_FORM);
  const [savingEmergency, setSavingEmergency] = useState(false);

  const [skillInput, setSkillInput] = useState('');

  const [education, setEducation] = useState<EmployeeEducation[]>([]);
  const [showEducationForm, setShowEducationForm] = useState(false);
  const [educationForm, setEducationForm] = useState(EMPTY_EDUCATION_FORM);
  const [savingEducation, setSavingEducation] = useState(false);

  const [experience, setExperience] = useState<EmployeeWorkExperience[]>([]);
  const [showExperienceForm, setShowExperienceForm] = useState(false);
  const [experienceForm, setExperienceForm] = useState(EMPTY_EXPERIENCE_FORM);
  const [savingExperience, setSavingExperience] = useState(false);

  function reload(empId: string) {
    supabase
      .from('employees')
      .select('*')
      .eq('id', empId)
      .single()
      .then(({ data }) => {
        if (data) {
          // skills is a new column — normalize to [] if the migration adding
          // it hasn't been run yet, so the page degrades instead of crashing.
          setEmployee({ ...data, skills: data.skills ?? [] });
          setProfileForm({
            name: data.name ?? '',
            email: data.email ?? '',
            phone: data.phone ?? '',
            address: data.address ?? '',
            department: data.department ?? '',
            designation: data.designation ?? '',
          });
          setEmergencyForm({
            emergency_contact_name: data.emergency_contact_name ?? '',
            emergency_contact_relationship: data.emergency_contact_relationship ?? '',
            emergency_contact_phone: data.emergency_contact_phone ?? '',
          });
        }
      });
    supabase
      .from('point_redemptions')
      .select('*')
      .eq('employee_id', empId)
      .order('created_at', { ascending: false })
      .then(({ data }) => setRedemptions(data ?? []));
    supabase.rpc('get_leaderboard').then(({ data }) => {
      const rows = (data as LeaderboardRow[]) ?? [];
      setBoard(rows.find(r => r.employee_id === empId) ?? null);
    });
    supabase
      .from('employee_education')
      .select('*')
      .eq('employee_id', empId)
      .order('year', { ascending: false })
      .then(({ data }) => setEducation(data ?? []));
    supabase
      .from('employee_work_experience')
      .select('*')
      .eq('employee_id', empId)
      .order('start_date', { ascending: false })
      .then(({ data }) => setExperience(data ?? []));
  }

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: profile } = await supabase
        .from('profiles')
        .select('employee_id')
        .eq('id', data.user.id)
        .single();
      setLoading(false);
      if (profile?.employee_id) reload(profile.employee_id);
    });
  }, []);

  // update_my_profile() replaces the whole editable row at once, so every
  // call passes the full current state — only the field actually being
  // changed differs from what's already there (profileForm/emergencyForm are
  // kept in sync via reload() after each save, same as the photo-only save
  // below relies on profileForm already reflecting saved values).
  async function saveProfile(overrides: { photoUrl?: string | null; skills?: string[]; emergency?: typeof EMPTY_EMERGENCY_FORM } = {}) {
    const emergency = overrides.emergency ?? emergencyForm;
    const { error } = await supabase.rpc('update_my_profile', {
      p_name: profileForm.name,
      p_email: profileForm.email || null,
      p_phone: profileForm.phone || null,
      p_address: profileForm.address || null,
      p_department: profileForm.department || null,
      p_designation: profileForm.designation || null,
      p_photo_url: overrides.photoUrl !== undefined ? overrides.photoUrl : employee?.profile_photo_url ?? null,
      p_skills: overrides.skills ?? employee?.skills ?? [],
      p_emergency_contact_name: emergency.emergency_contact_name || null,
      p_emergency_contact_relationship: emergency.emergency_contact_relationship || null,
      p_emergency_contact_phone: emergency.emergency_contact_phone || null,
    });
    return error;
  }

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!employee) return;
    setSavingProfile(true);
    setProfileError(null);
    setProfileSaved(false);
    const error = await saveProfile();
    setSavingProfile(false);
    if (error) {
      setProfileError(error.message);
      return;
    }
    setProfileSaved(true);
    reload(employee.id);
  }

  async function handleSaveEmergency(e: React.FormEvent) {
    e.preventDefault();
    if (!employee) return;
    setSavingEmergency(true);
    const error = await saveProfile();
    setSavingEmergency(false);
    if (error) {
      alert(`Could not save: ${error.message}`);
      return;
    }
    reload(employee.id);
  }

  async function addSkill() {
    const skill = skillInput.trim();
    if (!skill || !employee) return;
    if (employee.skills.includes(skill)) {
      setSkillInput('');
      return;
    }
    const error = await saveProfile({ skills: [...employee.skills, skill] });
    if (error) {
      alert(`Could not add skill: ${error.message}`);
      return;
    }
    setSkillInput('');
    reload(employee.id);
  }

  async function removeSkill(skill: string) {
    if (!employee) return;
    const error = await saveProfile({ skills: employee.skills.filter(s => s !== skill) });
    if (error) {
      alert(`Could not remove skill: ${error.message}`);
      return;
    }
    reload(employee.id);
  }

  async function handleAddEducation(e: React.FormEvent) {
    e.preventDefault();
    if (!employee) return;
    setSavingEducation(true);
    const { error } = await supabase.from('employee_education').insert({
      employee_id: employee.id,
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
    reload(employee.id);
  }

  async function handleDeleteEducation(id: string) {
    if (!employee) return;
    if (!confirm('Remove this education entry?')) return;
    await supabase.from('employee_education').delete().eq('id', id);
    reload(employee.id);
  }

  async function handleAddExperience(e: React.FormEvent) {
    e.preventDefault();
    if (!employee) return;
    setSavingExperience(true);
    const { error } = await supabase.from('employee_work_experience').insert({
      employee_id: employee.id,
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
    reload(employee.id);
  }

  async function handleDeleteExperience(id: string) {
    if (!employee) return;
    if (!confirm('Remove this work experience entry?')) return;
    await supabase.from('employee_work_experience').delete().eq('id', id);
    reload(employee.id);
  }

  function openPhotoPicker() {
    photoInputRef.current?.click();
  }

  async function handlePhotoSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !employee) return;

    setUploadingPhoto(true);
    const ext = file.name.split('.').pop() || 'jpg';
    const path = `employee-photos/${employee.id}-${Date.now()}.${ext}`;
    const { error: uploadError } = await supabase.storage.from('attendance-selfies').upload(path, file, {
      contentType: file.type || 'image/jpeg',
    });
    if (uploadError) {
      setUploadingPhoto(false);
      alert(`Photo upload failed: ${uploadError.message}`);
      return;
    }
    const { data: publicUrl } = supabase.storage.from('attendance-selfies').getPublicUrl(path);
    const rpcError = await saveProfile({ photoUrl: publicUrl.publicUrl });
    setUploadingPhoto(false);
    if (rpcError) {
      alert(`Could not save photo: ${rpcError.message}`);
      return;
    }
    reload(employee.id);
  }

  async function handleRedeemSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!employee) return;
    setRedeemError(null);
    if (redeemPoints <= 0) {
      setRedeemError('Enter how many points you want to redeem.');
      return;
    }
    if (board && redeemPoints > board.total_points) {
      setRedeemError(`You only have ${board.total_points} points available.`);
      return;
    }
    setSubmittingRedeem(true);
    const { error } = await supabase.from('point_redemptions').insert({
      employee_id: employee.id,
      points_requested: redeemPoints,
      note: redeemNote || null,
    });
    setSubmittingRedeem(false);
    if (error) {
      setRedeemError(error.message);
      return;
    }
    setShowRedeem(false);
    setRedeemPoints(0);
    setRedeemNote('');
    reload(employee.id);
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace('/login');
  }

  function updateField(key: keyof typeof EMPTY_PROFILE_FORM, value: string) {
    setProfileForm(f => ({ ...f, [key]: value }));
    setProfileSaved(false);
  }

  if (loading) {
    return (
      <EmployeeShell title="Profile">
        <p className="text-center text-sm text-slate-400">Loading…</p>
      </EmployeeShell>
    );
  }

  if (!employee) {
    return (
      <EmployeeShell title="Profile">
        <p className="mt-10 text-center text-sm text-warning-text">Your account isn&apos;t linked to an employee record yet.</p>
      </EmployeeShell>
    );
  }

  const days = tenureDays(employee.date_of_joining, employee.resigned_at);

  return (
    <EmployeeShell title="Profile">
      <input ref={photoInputRef} type="file" accept="image/*" onChange={handlePhotoSelected} className="hidden" />

      <div className="mb-5 flex flex-col items-center rounded-xl border border-slate-200 bg-white p-6">
        <button
          onClick={openPhotoPicker}
          title="Change photo"
          className="relative mb-3 h-20 w-20 overflow-hidden rounded-full bg-accent/10 text-2xl font-semibold text-accent"
        >
          {uploadingPhoto ? (
            <span className="flex h-full w-full items-center justify-center text-sm">…</span>
          ) : employee.profile_photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={employee.profile_photo_url} alt={employee.name} className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center">{employee.name.slice(0, 1)}</span>
          )}
        </button>
        <button onClick={openPhotoPicker} className="mb-2 text-xs font-medium text-accent hover:underline">
          Change photo
        </button>
        <h1 className="text-lg font-semibold text-ink">{employee.name}</h1>
        <p className="text-sm text-slate-500">{employee.designation ?? '—'}</p>
        <p className="text-xs text-slate-400">{employee.department ?? '—'}</p>
      </div>

      <div className="mb-5 rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm text-slate-500">Reward points</span>
          <span className="text-2xl font-bold text-ink">{board?.total_points ?? 0}</span>
        </div>
        <button
          onClick={() => setShowRedeem(true)}
          className="w-full rounded-lg bg-accent py-2 text-sm font-semibold text-white hover:bg-accent/90"
        >
          Redeem points
        </button>

        {redemptions.length > 0 && (
          <div className="mt-4 divide-y divide-slate-100 border-t border-slate-100 pt-2">
            {redemptions.map(r => (
              <div key={r.id} className="flex items-center gap-3 py-2">
                <div className="flex-1">
                  <div className="text-sm text-ink">{r.points_requested} pts</div>
                  {r.note && <div className="text-xs text-slate-400">{r.note}</div>}
                </div>
                <Badge tone={statusTone(r.status)}>{r.status}</Badge>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mb-5 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink">Employment</h2>
        <p className="mb-3 text-xs text-slate-400">Set by HR/Admin — not editable here.</p>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-400">Date of joining</span>
            <span className="text-ink">{employee.date_of_joining ?? '—'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">{employee.resigned_at ? 'Days worked' : 'Days with company'}</span>
            <span className="text-ink">{days !== null ? `${days} days` : '—'}</span>
          </div>
          {employee.resigned_at && (
            <div className="flex justify-between">
              <span className="text-slate-400">Resigned</span>
              <span className="text-ink">{employee.resigned_at}</span>
            </div>
          )}
        </div>
      </div>

      <form onSubmit={handleSaveProfile} className="mb-5 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink">My Details</h2>

        <label className="mb-1 block text-xs font-medium text-slate-600">Name</label>
        <input
          required
          value={profileForm.name}
          onChange={e => updateField('name', e.target.value)}
          className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
        <label className="mb-1 block text-xs font-medium text-slate-600">Email</label>
        <input
          type="email"
          value={profileForm.email}
          onChange={e => updateField('email', e.target.value)}
          className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
        <label className="mb-1 block text-xs font-medium text-slate-600">Phone</label>
        <input
          value={profileForm.phone}
          onChange={e => updateField('phone', e.target.value)}
          className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
        <label className="mb-1 block text-xs font-medium text-slate-600">Address</label>
        <textarea
          value={profileForm.address}
          onChange={e => updateField('address', e.target.value)}
          rows={2}
          className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
        <label className="mb-1 block text-xs font-medium text-slate-600">Department</label>
        <input
          value={profileForm.department}
          onChange={e => updateField('department', e.target.value)}
          className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
        <label className="mb-1 block text-xs font-medium text-slate-600">Designation</label>
        <input
          value={profileForm.designation}
          onChange={e => updateField('designation', e.target.value)}
          className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />

        {profileError && <p className="mb-3 text-sm text-critical">{profileError}</p>}
        {profileSaved && <p className="mb-3 text-sm text-good-text">Saved.</p>}
        <button
          type="submit"
          disabled={savingProfile}
          className="w-full rounded-lg bg-accent py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {savingProfile ? 'Saving…' : 'Save changes'}
        </button>
      </form>

      <form onSubmit={handleSaveEmergency} className="mb-5 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink">Emergency Contact</h2>
        <label className="mb-1 block text-xs font-medium text-slate-600">Name</label>
        <input
          value={emergencyForm.emergency_contact_name}
          onChange={e => setEmergencyForm(f => ({ ...f, emergency_contact_name: e.target.value }))}
          className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
        <label className="mb-1 block text-xs font-medium text-slate-600">Relationship</label>
        <input
          value={emergencyForm.emergency_contact_relationship}
          onChange={e => setEmergencyForm(f => ({ ...f, emergency_contact_relationship: e.target.value }))}
          className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
        <label className="mb-1 block text-xs font-medium text-slate-600">Phone</label>
        <input
          value={emergencyForm.emergency_contact_phone}
          onChange={e => setEmergencyForm(f => ({ ...f, emergency_contact_phone: e.target.value }))}
          className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={savingEmergency}
          className="w-full rounded-lg bg-accent py-2 text-sm font-semibold text-white disabled:opacity-60"
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
                  <span className="block text-xs text-slate-500">{[ed.institution, ed.year ? String(ed.year) : null].filter(Boolean).join(', ')}</span>
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

      <button
        onClick={handleSignOut}
        className="mb-6 w-full rounded-lg border border-slate-200 bg-white py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
      >
        Sign out
      </button>

      {showRedeem && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4">
          <form onSubmit={handleRedeemSubmit} className="w-full max-w-sm rounded-xl bg-white p-6 shadow-lg">
            <h3 className="mb-1 text-lg font-semibold text-ink">Redeem Points</h3>
            <p className="mb-4 text-xs text-slate-500">You have {board?.total_points ?? 0} points. HR/Admin will review this request.</p>

            <label className="mb-1 block text-xs font-medium text-slate-600">Points to redeem</label>
            <input
              type="number"
              min={1}
              max={board?.total_points ?? undefined}
              required
              value={redeemPoints || ''}
              onChange={e => setRedeemPoints(Number(e.target.value))}
              className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <label className="mb-1 block text-xs font-medium text-slate-600">Note (optional)</label>
            <textarea
              value={redeemNote}
              onChange={e => setRedeemNote(e.target.value)}
              rows={2}
              className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            {redeemError && <p className="mb-3 text-sm text-critical">{redeemError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowRedeem(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submittingRedeem}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-60"
              >
                {submittingRedeem ? 'Submitting…' : 'Submit request'}
              </button>
            </div>
          </form>
        </div>
      )}

      {showEducationForm && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4">
          <form onSubmit={handleAddEducation} className="w-full max-w-sm rounded-xl bg-white p-6 shadow-lg">
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
          <form onSubmit={handleAddExperience} className="w-full max-w-sm rounded-xl bg-white p-6 shadow-lg">
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
                <DatePicker value={experienceForm.start_date} onChange={v => setExperienceForm(f => ({ ...f, start_date: v }))} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">End date</label>
                <DatePicker value={experienceForm.end_date} onChange={v => setExperienceForm(f => ({ ...f, end_date: v }))} />
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
    </EmployeeShell>
  );
}
