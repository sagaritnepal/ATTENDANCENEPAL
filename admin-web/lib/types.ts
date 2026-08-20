export type Branch = {
  id: string;
  name: string;
  branch_code: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
};

export type Department = {
  id: string;
  name: string;
  created_at: string;
};

export type BranchDepartment = {
  branch_id: string;
  department_id: string;
};

export type Employee = {
  id: string;
  employee_code: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  department: string | null;
  designation: string | null;
  branch_id: string | null;
  fingerprint_id: string | null;
  username: string | null;
  profile_photo_url: string | null;
  status: 'active' | 'inactive';
  date_of_joining: string | null;
  resigned_at: string | null;
  salary: number | null;
  allowance: number | null;
  pf_rate: number | null;
  ssf_rate: number | null;
  tds_rate: number | null;
  emergency_contact_name: string | null;
  emergency_contact_relationship: string | null;
  emergency_contact_phone: string | null;
  skills: string[];
  pan_no: string | null;
  ssf_no: string | null;
  attendance_exempt: boolean;
  created_at: string;
};

export type EmployeeEducation = {
  id: string;
  employee_id: string;
  degree: string;
  institution: string | null;
  year: number | null;
};

export type EmployeeWorkExperience = {
  id: string;
  employee_id: string;
  employer: string;
  role: string | null;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
};

export type PointRedemption = {
  id: string;
  employee_id: string;
  points_requested: number;
  note: string | null;
  status: 'pending' | 'approved' | 'rejected';
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
};

export type Profile = {
  id: string;
  employee_id: string | null;
  role: 'admin' | 'hr' | 'employee';
  full_name: string | null;
  company_name: string | null;
  pan_no: string | null;
  location: string | null;
  photo_url: string | null;
};

export type Device = {
  id: string;
  name: string;
  branch_id: string | null;
  ip_address: string;
  port: number;
  serial_number: string | null;
  status: 'online' | 'offline';
  last_sync: string | null;
};

export type DeviceSyncEvent = {
  id: string;
  device_id: string;
  sync_type: 'users' | 'logs';
  status: 'pending' | 'running' | 'success' | 'failed' | 'cancelled';
  requested_at: string;
  completed_at: string | null;
  summary: string | null;
  error: string | null;
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
  punch_type: '0' | '1' | '2' | '3';
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
  lat: number | null;
  lng: number | null;
};

export type AttendanceGpsRequest = {
  id: string;
  employee_id: string;
  punch_type: '0' | '1' | '2' | '3';
  punch_time: string;
  lat: number | null;
  lng: number | null;
  accuracy_m: number | null;
  status: 'pending' | 'approved' | 'rejected';
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
};

export type TaskStatus = 'pending' | 'in_progress' | 'submitted' | 'approved' | 'rejected';
export type TaskSource = 'assigned' | 'self';

export type Task = {
  id: string;
  title: string;
  description: string | null;
  assigned_to: string;
  assigned_by: string | null;
  points: number;
  status: TaskStatus;
  source: TaskSource;
  due_date: string | null;
  work_notes: string | null;
  review_note: string | null;
  submitted_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
};

export type TaskTimeLog = {
  id: string;
  task_id: string;
  employee_id: string;
  started_at: string;
  ended_at: string | null;
  created_at: string;
};

export type LeaderboardRow = {
  employee_id: string;
  name: string;
  department: string | null;
  total_points: number;
  tasks_completed: number;
  profile_photo_url: string | null;
};

export type CompanyHoliday = {
  id: string;
  company_id: string;
  holiday_date: string;
  name: string;
  created_by: string | null;
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
  /** Completed-break minutes for this day (20260820100000_break_punches.sql)
   * — paid, NOT subtracted from total_hours/overtime_hours, display only. */
  break_minutes: number;
  manually_corrected: boolean;
  overtime_approved: boolean;
  computed_at: string;
};
