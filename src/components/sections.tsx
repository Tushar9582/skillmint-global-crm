'use client';

import { CATALOG } from '@/lib/catalog';
import { DataTablePage } from './data-table';
import { EmployeesPage, HandoverPage, EmployeeProfilePage } from './team';
import { EmployeeDirectoryPage } from './hr/employees';
import { AttendanceRegisterPage, MyAttendancePage } from './hr/attendance';
import { HolidaysPage } from './hr/holidays';
import { ShiftsPage } from './hr/shifts';
import { LeavePage } from './hr/leave';
import { OvertimePage } from './hr/overtime';
import { MyPayslipsPage, PayrollPage } from './hr/payroll';
import { BillingPage } from './hr/finance';
import { AnalyticsPage } from './hr/analytics';
import { CrmConfigPage } from './hr/crm-config';
import { DailyReportPage, ReportsPage, AuditPage, ActivityHistoryPage, NotificationsPage, ImportsPage, DuplicateReviewsPage, PermissionsPage } from './special-pages';

export function SectionView({section}:{section:string}) {
  if(CATALOG[section])return <DataTablePage resource={section}/>;
  switch(section){
    case 'hr-employees':return <EmployeeDirectoryPage/>;
    case 'my-attendance':return <MyAttendancePage/>;
    case 'attendance-register':return <AttendanceRegisterPage/>;
    case 'holidays':return <HolidaysPage/>;
    case 'shifts':return <ShiftsPage/>;
    case 'leave':return <LeavePage/>;
    case 'overtime':return <OvertimePage/>;
    case 'payroll':return <PayrollPage/>;
    case 'billing':return <BillingPage/>;
    case 'analytics':return <AnalyticsPage/>;
    case 'crm-settings':return <CrmConfigPage/>;
    case 'my-payslips':return <MyPayslipsPage/>;
    case 'employees':return <EmployeesPage/>;
    case 'handover':return <HandoverPage/>;
    case 'daily-report':return <DailyReportPage/>;
    case 'reports':return <ReportsPage/>;
    case 'notifications':return <NotificationsPage/>;
    case 'audit':return <AuditPage/>;
    case 'activities':return <ActivityHistoryPage/>;
    case 'imports':return <ImportsPage/>;
    case 'duplicate-reviews':return <DuplicateReviewsPage/>;
    case 'profile':return <EmployeeProfilePage/>;
    case 'permissions':return <PermissionsPage/>;
    default:return null;
  }
}
