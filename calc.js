// Payroll & attendance calculation engine
// Turns raw punch logs into working hours, lateness, early departure, and overtime.

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function findShiftForEmployee(db, employee) {
  let shift = db.prepare('SELECT * FROM shifts WHERE employee_id = ?').get(employee.id);
  if (!shift && employee.department) {
    shift = db.prepare('SELECT * FROM shifts WHERE department = ? AND employee_id IS NULL').get(employee.department);
  }
  if (!shift) {
    // sensible default: 09:00 - 18:00, 10 min grace
    shift = { name: 'Default', start_time: '09:00', end_time: '18:00', grace_minutes: 10 };
  }
  return shift;
}

// Groups punches by local calendar date (YYYY-MM-DD) based on punch_time ISO string
function groupByDate(logs) {
  const byDate = {};
  for (const log of logs) {
    const date = log.punch_time.slice(0, 10);
    byDate[date] = byDate[date] || [];
    byDate[date].push(log);
  }
  return byDate;
}

function calculateDailyRecord(db, employee, dateStr, logsForDay) {
  const shift = findShiftForEmployee(db, employee);
  const sorted = [...logsForDay].sort((a, b) => a.punch_time.localeCompare(b.punch_time));

  const checkIn = sorted.find(l => l.punch_type === '0') || sorted[0];
  const checkOutCandidates = sorted.filter(l => l.punch_type === '1');
  const checkOut = checkOutCandidates.length ? checkOutCandidates[checkOutCandidates.length - 1] : (sorted.length > 1 ? sorted[sorted.length - 1] : null);

  const shiftStartMin = toMinutes(shift.start_time);
  const shiftEndMin = toMinutes(shift.end_time);
  const shiftDurationMin = shiftEndMin > shiftStartMin ? shiftEndMin - shiftStartMin : (24 * 60 - shiftStartMin + shiftEndMin);

  let totalMinutes = 0;
  let lateMinutes = 0;
  let earlyDepartureMinutes = 0;
  let overtimeMinutes = 0;
  let isLate = false;
  let isEarlyDeparture = false;

  const inDate = new Date(checkIn.punch_time);
  const inMinOfDay = inDate.getUTCHours() * 60 + inDate.getUTCMinutes();

  if (inMinOfDay > shiftStartMin + shift.grace_minutes) {
    isLate = true;
    lateMinutes = inMinOfDay - shiftStartMin;
  }

  if (checkOut && checkOut !== checkIn) {
    const outDate = new Date(checkOut.punch_time);
    totalMinutes = Math.round((outDate - inDate) / 60000);
    const outMinOfDay = outDate.getUTCHours() * 60 + outDate.getUTCMinutes();
    if (outMinOfDay < shiftEndMin) {
      isEarlyDeparture = true;
      earlyDepartureMinutes = shiftEndMin - outMinOfDay;
    }
    if (totalMinutes > shiftDurationMin) {
      overtimeMinutes = totalMinutes - shiftDurationMin;
    }
  }

  return {
    employee_id: employee.id,
    employee_name: employee.name,
    date: dateStr,
    shift: shift.name,
    check_in: checkIn ? checkIn.punch_time : null,
    check_out: checkOut && checkOut !== checkIn ? checkOut.punch_time : null,
    total_hours: +(totalMinutes / 60).toFixed(2),
    is_late: isLate,
    late_minutes: lateMinutes,
    is_early_departure: isEarlyDeparture,
    early_departure_minutes: earlyDepartureMinutes,
    overtime_hours: +(overtimeMinutes / 60).toFixed(2),
    punch_count: sorted.length,
  };
}

function buildPayrollReport(db, employee, logs) {
  const byDate = groupByDate(logs);
  return Object.keys(byDate).sort().map(date => calculateDailyRecord(db, employee, date, byDate[date]));
}

module.exports = { buildPayrollReport, calculateDailyRecord, findShiftForEmployee };
