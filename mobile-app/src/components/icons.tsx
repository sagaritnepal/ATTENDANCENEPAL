import React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

export type IconProps = { size?: number; color?: string };

export function HomeIcon({ size = 20, color = '#94a3b8' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2}>
      <Path strokeLinecap="round" strokeLinejoin="round" d="M3 11.5 12 4l9 7.5M5 10v10h14V10" />
    </Svg>
  );
}
export function UsersIcon({ size = 20, color = '#94a3b8' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2}>
      <Path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M16 11a4 4 0 1 0-4-4M2 21v-1a6 6 0 0 1 6-6h1a6 6 0 0 1 6 6v1M17 14a6 6 0 0 1 5 6v1"
      />
    </Svg>
  );
}
export function ClockIcon({ size = 20, color = '#94a3b8' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2}>
      <Circle cx={12} cy={12} r={9} />
      <Path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 3" />
    </Svg>
  );
}
export function LeaveIcon({ size = 20, color = '#94a3b8' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2}>
      <Path strokeLinecap="round" strokeLinejoin="round" d="M3 12h5l2-3h4l2 3h5M4 12l1.5 7h13L20 12" />
    </Svg>
  );
}
export function CorrectionIcon({ size = 20, color = '#94a3b8' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2}>
      <Path strokeLinecap="round" strokeLinejoin="round" d="M12 20a8 8 0 1 0-6.93-4M4 15v5h5" />
      <Path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l2.5 2.5" />
    </Svg>
  );
}
export function TaskIcon({ size = 20, color = '#94a3b8' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2}>
      <Rect x={4} y={4} width={16} height={16} rx={2} />
      <Path strokeLinecap="round" strokeLinejoin="round" d="m8 12 2.5 2.5L16 9" />
    </Svg>
  );
}
export function BranchIcon({ size = 20, color = '#94a3b8' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2}>
      <Path strokeLinecap="round" strokeLinejoin="round" d="M12 21s-7-6.1-7-11a7 7 0 1 1 14 0c0 4.9-7 11-7 11Z" />
      <Circle cx={12} cy={10} r={2.5} />
    </Svg>
  );
}
export function ResignedIcon({ size = 20, color = '#94a3b8' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2}>
      <Circle cx={9} cy={8} r={3.5} />
      <Path strokeLinecap="round" strokeLinejoin="round" d="M2.5 19c1-3.2 3.6-5 6.5-5s5.5 1.8 6.5 5M15.5 9h6" />
    </Svg>
  );
}
export function CalendarViewIcon({ size = 20, color = '#94a3b8' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2}>
      <Rect x={3} y={5} width={18} height={16} rx={2} />
      <Path strokeLinecap="round" d="M3 10h18M8 3v4M16 3v4" />
      <Circle cx={8.5} cy={15} r={1.2} fill={color} stroke="none" />
    </Svg>
  );
}
export function CalendarIcon({ size = 20, color = '#94a3b8' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2}>
      <Rect x={3} y={5} width={18} height={16} rx={2} />
      <Path strokeLinecap="round" d="M3 10h18M8 3v4M16 3v4" />
    </Svg>
  );
}
export function DeviceIcon({ size = 20, color = '#94a3b8' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2}>
      <Rect x={6} y={6} width={12} height={12} rx={2} />
      <Path strokeLinecap="round" d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
    </Svg>
  );
}
export function CardIcon({ size = 20, color = '#94a3b8' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2}>
      <Rect x={2} y={5} width={20} height={14} rx={2} />
      <Path strokeLinecap="round" d="M2 10h20" />
    </Svg>
  );
}
export function CheckCircleIcon({ size = 20, color = '#94a3b8' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2}>
      <Circle cx={12} cy={12} r={9} />
      <Path strokeLinecap="round" strokeLinejoin="round" d="m8.5 12.5 2.5 2.5 5-5" />
    </Svg>
  );
}
export function PersonIcon({ size = 20, color = '#94a3b8' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2}>
      <Circle cx={12} cy={8} r={3.5} />
      <Path strokeLinecap="round" strokeLinejoin="round" d="M4.5 20c1.2-3.5 4-5.5 7.5-5.5s6.3 2 7.5 5.5" />
    </Svg>
  );
}
export function ChevronIcon({ size = 16, color = '#94a3b8' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2}>
      <Path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
    </Svg>
  );
}
export function MenuIcon({ size = 20, color = '#64748b' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2}>
      <Path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
    </Svg>
  );
}
export function BellIcon({ size = 20, color = '#64748b' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2}>
      <Path strokeLinecap="round" strokeLinejoin="round" d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <Path strokeLinecap="round" d="M13.7 21a2 2 0 0 1-3.4 0" />
    </Svg>
  );
}
export function KeyIcon({ size = 14, color = '#475569' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2}>
      <Circle cx={8} cy={15} r={4} />
      <Path strokeLinecap="round" strokeLinejoin="round" d="m10.8 12.2 8-8M15.5 3.5l2 2M18.5 6.5l2 2" />
    </Svg>
  );
}
export function EditIcon({ size = 14, color = '#fff' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2}>
      <Path strokeLinecap="round" strokeLinejoin="round" d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </Svg>
  );
}
export function SignOutIcon({ size = 14, color = '#b91c1c' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2}>
      <Path strokeLinecap="round" strokeLinejoin="round" d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
    </Svg>
  );
}
export function MailIcon({ size = 14, color = '#3b82f6' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2}>
      <Rect x={3} y={5} width={18} height={14} rx={2} />
      <Path strokeLinecap="round" strokeLinejoin="round" d="m4 7 8 6 8-6" />
    </Svg>
  );
}
export function BuildingIcon({ size = 14, color = '#a855f7' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2}>
      <Rect x={4} y={3} width={16} height={18} rx={1} />
      <Path strokeLinecap="round" d="M8 7h1M12 7h1M16 7h1M8 11h1M12 11h1M16 11h1M8 15h1M12 15h1M16 15h1" />
      <Path d="M10 21v-4h4v4" />
    </Svg>
  );
}
export function PinIcon({ size = 14, color = '#f97316' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2}>
      <Path strokeLinecap="round" strokeLinejoin="round" d="M12 21s-7-6.1-7-11a7 7 0 1 1 14 0c0 4.9-7 11-7 11Z" />
      <Circle cx={12} cy={10} r={2.5} />
    </Svg>
  );
}
export function CalendarDotIcon({ size = 14, color = '#0f766e' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2}>
      <Rect x={3} y={5} width={18} height={16} rx={2} />
      <Path strokeLinecap="round" d="M3 10h18M8 3v4M16 3v4" />
      <Circle cx={12} cy={15} r={1.3} fill={color} stroke="none" />
    </Svg>
  );
}
