'use client';

import { CATALOG } from '@/lib/catalog';
import { DashboardView } from './dashboard';
import { AiResumeBuilderPage } from './ai-resume-builder';
import { DataTablePage } from './data-table';
import { EmployeesPage, HandoverPage, EmployeeProfilePage } from './team';
import { BillingPage } from './hr/finance';
import { CrmConfigPage } from './hr/crm-config';
import { DailyReportPage, ReportsPage, AuditPage, ActivityHistoryPage, NotificationsPage, ImportsPage, DuplicateReviewsPage } from './special-pages';

export function SectionView({section}:{section:string}) {
  if(CATALOG[section])return <DataTablePage resource={section}/>;
  switch(section){
    case 'ai-resume-builder':return <AiResumeBuilderPage/>;
    case 'leads-dashboard':return <DashboardView/>;
    case 'billing':return <BillingPage/>;
    case 'crm-settings':return <CrmConfigPage/>;
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
    default:return null;
  }
}
