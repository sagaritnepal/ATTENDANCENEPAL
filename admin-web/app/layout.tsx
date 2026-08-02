import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Attendance Nepal Admin',
  description: 'Attendance, payroll, and biometric device console',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
