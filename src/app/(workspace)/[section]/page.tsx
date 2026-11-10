import { notFound, redirect } from 'next/navigation';
import { SectionView } from '@/components/sections';

const PAGES=new Set(['company-leads','clients','jobs','candidates','applications',
  'leads-dashboard',
  'interviews','followups','activities','employees','handover','reports','notifications','audit',
  'imports','duplicate-reviews','daily-report','profile','billing','crm-settings']);

export default async function SectionPage({params}:{params:Promise<{section:string}>}) {
  const {section}=await params;
  // Old HRMS links should return to the remaining Lead Management workspace.
  if(['hrms-dashboard','hr-employees','my-attendance','attendance-register','holidays','shifts','leave','overtime','payroll','my-payslips','analytics','permissions'].includes(section))redirect('/dashboard');
  if(!PAGES.has(section))notFound();
  return <SectionView section={section}/>;
}
