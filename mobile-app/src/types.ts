export type PunchMethod = 'zkteco' | 'gps' | 'qr' | 'selfie';

export type Profile = {
  id: string;
  employee_id: string | null;
  role: 'admin' | 'employee';
};

export type Employee = {
  id: string;
  employee_code: string;
  name: string;
  department: string | null;
  designation: string | null;
  phone: string | null;
  email: string | null;
  branch_id: string | null;
  fingerprint_id: string | null;
  status: 'active' | 'inactive';
  salary: number | null;
  profile_photo_url: string | null;
};

export type Shift = {
  id: string;
  name: string;
  type: 'fixed' | 'flexible' | 'rotational';
  start_time: string;
  end_time: string;
  grace_minutes: number;
  department: string | null;
  employee_id: string | null;
};

export type PayrollSummary = {
  id: string;
  employee_id: string;
  work_date: string;
  total_hours: number;
  overtime_hours: number;
  is_late: boolean;
  late_minutes: number;
};

export type AttendanceLog = {
  id: string;
  employee_id: string;
  punch_time: string;
  punch_type: '0' | '1';
  method: PunchMethod;
  lat?: number | null;
  lng?: number | null;
  selfie_url?: string | null;
  match_score?: number | null;
};

export type LeaveType = 'sick' | 'casual' | 'annual' | 'unpaid';

export type LeaveRequest = {
  id: string;
  employee_id: string;
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  reason: string | null;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
};
