import { notFound } from 'next/navigation';
import { SectionView } from '@/components/sections';

const PAGES=new Set(['company-leads','clients','jobs','candidates','applications',
  'interviews','followups','activities','employees','handover','reports','notifications','audit',
  'imports','duplicate-reviews','daily-report','profile','permissions',
  'hr-employees','my-attendance','attendance-register','holidays','shifts','leave','overtime','payroll','my-payslips','billing','analytics','crm-settings']);

export default async function SectionPage({params}:{params:Promise<{section:string}>}) {
  const {section}=await params;
  if(!PAGES.has(section))notFound();
  return <SectionView section={section}/>;
}
