import type { Metadata } from 'next';
import './globals.css';

export const metadata:Metadata={
  title:'SkillMint Global | Recruitment CRM',
  description:'Secure company leads, candidates, resume management and daily recruitment workflows.',
};

export default function RootLayout({children}:{children:React.ReactNode}) {
  return <html lang="en"><body>{children}</body></html>;
}
