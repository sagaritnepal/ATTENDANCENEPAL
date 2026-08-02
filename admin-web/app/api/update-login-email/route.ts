import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, supabaseAdminConfigured } from '@/lib/supabase-admin';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
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

  // Verify the caller is a signed-in admin/HR before doing anything privileged.
  const { data: callerData, error: callerError } = await admin.auth.getUser(token);
  if (callerError || !callerData.user) {
    return NextResponse.json({ error: 'Invalid or expired session.' }, { status: 401 });
  }
  const { data: callerProfile } = await admin
    .from('profiles')
    .select('role')
    .eq('id', callerData.user.id)
    .single();

  const body = await req.json().catch(() => null);
  const employeeId = typeof body?.employeeId === 'string' ? body.employeeId : null;
  const userId = typeof body?.userId === 'string' ? body.userId : null;
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  if ((!employeeId && !userId) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json(
      { error: 'employeeId or userId, plus a valid email, are required.' },
      { status: 400 }
    );
  }

  let targetUserId = userId;
  if (employeeId) {
    // Changing an employee's login username: admin or HR.
    if (callerProfile?.role !== 'admin' && callerProfile?.role !== 'hr') {
      return NextResponse.json({ error: 'Only admin/HR can change a login username.' }, { status: 403 });
    }
    const { data: link, error: linkError } = await admin
      .from('profiles')
      .select('id')
      .eq('employee_id', employeeId)
      .maybeSingle();
    if (linkError || !link) {
      return NextResponse.json({ error: 'This employee has no login to update.' }, { status: 404 });
    }
    targetUserId = link.id;
  } else {
    // Changing any account directly by user id — admin-only, matching the
    // same admin-only restriction as reset-password's direct-userId path.
    if (callerProfile?.role !== 'admin') {
      return NextResponse.json({ error: 'Only admins can update another account directly.' }, { status: 403 });
    }
  }

  const { error: updateError } = await admin.auth.admin.updateUserById(targetUserId!, { email });
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
