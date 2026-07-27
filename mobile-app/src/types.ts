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
  branch_id: string | null;
  profile_photo_url: string | null;
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
