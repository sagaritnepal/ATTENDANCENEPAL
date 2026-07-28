export type Branch = {
  id: string;
  name: string;
  branch_code: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
};

export type Employee = {
  id: string;
  employee_code: string;
  name: string;
  email: string | null;
  phone: string | null;
  department: string | null;
  designation: string | null;
  branch_id: string | null;
  fingerprint_id: string | null;
  profile_photo_url: string | null;
  status: 'active' | 'inactive';
  created_at: string;
};

export type Profile = {
  id: string;
  employee_id: string | null;
  role: 'admin' | 'hr' | 'employee';
};

export type Device = {
  id: string;
  name: string;
  branch_id: string;
  ip_address: string;
  port: number;
  status: 'online' | 'offline';
  last_sync: string | null;
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

export type AttendanceLog = {
  id: string;
  employee_id: string;
  device_id: string | null;
  punch_time: string;
  punch_type: '0' | '1';
  method: 'zkteco' | 'gps' | 'qr' | 'selfie';
  verification_mode: string | null;
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
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
};

export type CorrectionRequest = {
  id: string;
  employee_id: string;
  work_date: string;
  requested_check_in: string | null;
  requested_check_out: string | null;
  reason: string | null;
  status: 'pending' | 'approved' | 'rejected';
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
};

export type PayrollSummary = {
  id: string;
  employee_id: string;
  work_date: string;
  shift_name: string | null;
  check_in: string | null;
  check_out: string | null;
  total_hours: number;
  is_late: boolean;
  late_minutes: number;
  is_early_departure: boolean;
  early_departure_minutes: number;
  overtime_hours: number;
  manually_corrected: boolean;
  overtime_approved: boolean;
  computed_at: string;
};
