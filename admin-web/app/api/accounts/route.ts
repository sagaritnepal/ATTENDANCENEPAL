import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, supabaseAdminConfigured } from '@/lib/supabase-admin';

export const runtime = 'nodejs';

// Lists every login account with its role — admin-only, since it surfaces
// admin/HR accounts too (Employees page already lists employee logins, this
// is the equivalent for accounts that aren't tied to an employee row).
export async function GET(req: NextRequest) {
  if (!supabaseAdminConfigured) {
    return NextResponse.json(
      { error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY. Ask the app owner to set it in Vercel.' },
      { status: 500 }
    );
  }

  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) {
    return NextResponse.json({ error: 'Missing session token.' }, { status: 401 });
  }

  const admin = getSupabaseAdmin();

  const { data: callerData, error: callerError } = await admin.auth.getUser(token);
  if (callerError || !callerData.user) {
    return NextResponse.json({ error: 'Invalid or expired session.' }, { status: 401 });
  }
  const { data: callerProfile } = await admin.from('profiles').select('role').eq('id', callerData.user.id).single();

  // The Employees page (admin or HR) only needs employee-linked logins for
  // its "Login ID" column — never admin/HR accounts. The full list (Team
  // Accounts page) stays admin-only.
  const scope = req.nextUrl.searchParams.get('scope');
  if (scope === 'employees') {
    if (callerProfile?.role !== 'admin' && callerProfile?.role !== 'hr') {
      return NextResponse.json({ error: 'Only admin/HR can view employee logins.' }, { status: 403 });
    }
  } else if (callerProfile?.role !== 'admin') {
    return NextResponse.json({ error: 'Only admins can view team accounts.' }, { status: 403 });
  }

  let profilesQuery = admin.from('profiles').select('id, role, employee_id, employees(name)');
  if (scope === 'employees') {
    profilesQuery = profilesQuery.eq('role', 'employee').not('employee_id', 'is', null);
  }
  const { data: profiles, error: profilesError } = await profilesQuery;
  if (profilesError) {
    return NextResponse.json({ error: profilesError.message }, { status: 500 });
  }

  const { data: usersPage, error: usersError } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (usersError) {
    return NextResponse.json({ error: usersError.message }, { status: 500 });
  }
  const emailById = new Map(usersPage.users.map(u => [u.id, u.email ?? '']));

  const accounts = (profiles ?? []).map(p => ({
    id: p.id,
    email: emailById.get(p.id) ?? '',
    role: p.role,
    employeeId: p.employee_id,
    employeeName: (p as unknown as { employees?: { name: string }[] | null }).employees?.[0]?.name ?? null,
  }));

  return NextResponse.json({ accounts });
}
