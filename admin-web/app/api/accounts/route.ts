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
  if (callerProfile?.role !== 'admin') {
    return NextResponse.json({ error: 'Only admins can view team accounts.' }, { status: 403 });
  }

  const { data: profiles, error: profilesError } = await admin
    .from('profiles')
    .select('id, role, employee_id, employees(name)');
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
    employeeName: (p as unknown as { employees?: { name: string }[] | null }).employees?.[0]?.name ?? null,
  }));

  return NextResponse.json({ accounts });
}
