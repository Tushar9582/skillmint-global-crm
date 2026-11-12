'use client';

import { useState, type FormEvent } from 'react';
import { ArrowRight, BriefcaseBusiness, CheckCircle2, Eye, EyeOff, FileText,
  LoaderCircle, LockKeyhole, Mail, ShieldCheck, Sparkles, UsersRound } from 'lucide-react';

type LoginReply = {
  error?: string;
  user?: { must_change_password?: boolean };
};

const preview = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';

export function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setError('');
    setSubmitting(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
      const result = await response.json().catch(() => ({})) as LoginReply;
      if (!response.ok) {
        setError(result.error || (response.status === 503
          ? 'The login service is not configured yet. Contact your administrator.'
          : 'Unable to sign in. Please try again.'));
        return;
      }
      window.location.replace(result.user?.must_change_password ? '/profile' : '/dashboard');
    } catch {
      setError('Could not reach the login service. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return <main className="skillmint-auth">
    <section className="skillmint-auth-story" aria-label="SkillMint Global recruitment platform">
      <div className="skillmint-auth-story-inner">
        <div className="skillmint-auth-brand">
          <img src="/brand/skillmint-global-mark.png" alt="SkillMint Global" width="54" height="54" />
          <span><strong>skillmint</strong><small>G L O B A L</small></span>
        </div>

        <div className="skillmint-auth-hero">
          <span className="skillmint-auth-kicker"><Sparkles size={16} /> RECRUITMENT, REIMAGINED</span>
          <h1>One workspace.<br /><em>Smarter hiring.</em></h1>
          <p>Keep company leads, candidate resumes, interviews and recruiter follow-ups connected in one secure CRM.</p>
          <div className="skillmint-auth-pills" aria-label="Included CRM tools">
            <span><BriefcaseBusiness size={17}/> Company Leads</span>
            <span><FileText size={17}/> Resume Bank</span>
            <span><UsersRound size={17}/> Team Follow-ups</span>
          </div>
        </div>

        <div className="skillmint-auth-story-bottom">
          <ShieldCheck size={17}/>
          <span>Private Recruitment Workspace · SkillMint Global</span>
        </div>
      </div>
    </section>

    <section className="skillmint-auth-form-side">
      <div className="skillmint-auth-form-shell">
        <span className="skillmint-auth-welcome"><span className="skillmint-auth-welcome-dot"/> WELCOME BACK</span>
        <h2>Sign in to SkillMint</h2>
        <p className="skillmint-auth-subtitle">Enter your work credentials to access your recruitment dashboard.</p>

        {preview && <div className="skillmint-auth-preview" role="status">
          Preview environment: use your configured preview credentials. Real candidate data is not connected.
        </div>}

        <form className="skillmint-auth-form" onSubmit={signIn}>
          <label htmlFor="skillmint-email">Work email address</label>
          <div className="skillmint-auth-input">
            <Mail size={20} aria-hidden="true"/>
            <input id="skillmint-email" name="email" type="email" autoComplete="username"
              inputMode="email" autoCapitalize="none" spellCheck={false}
              placeholder="name@skillmintglobal.com" value={email} maxLength={254}
              onChange={e => {setEmail(e.target.value);if(error)setError('');}}
              required aria-invalid={Boolean(error)} disabled={submitting} />
          </div>

          <label htmlFor="skillmint-password">Password</label>
          <div className="skillmint-auth-input">
            <LockKeyhole size={20} aria-hidden="true"/>
            <input id="skillmint-password" name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password" placeholder="Enter your password"
              value={password} maxLength={256}
              onChange={e => {setPassword(e.target.value);if(error)setError('');}}
              required aria-invalid={Boolean(error)} disabled={submitting} />
            <button type="button" className="skillmint-auth-toggle"
              onClick={() => setShowPassword(v => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword} disabled={submitting}>
              {showPassword ? <EyeOff size={20}/> : <Eye size={20}/>}
            </button>
          </div>

          {error && <div className="skillmint-auth-error" role="alert">{error}</div>}

          <button className="skillmint-auth-submit" type="submit" disabled={submitting}>
            {submitting ? <><LoaderCircle size={20} className="skillmint-auth-spin"/> Signing in…</>
              : <>Sign in to Dashboard <ArrowRight size={20}/></>}
          </button>
        </form>

        <div className="skillmint-auth-assurance">
          <CheckCircle2 size={18}/>
          <span>Protected account access · Admin and Employee roles</span>
        </div>
        <p className="skillmint-auth-help">Need an account or password reset?<br />
          Contact your SkillMint administrator. Public sign-up is disabled.</p>
        <div className="skillmint-auth-copyright">© 2026 SkillMint Global. All rights reserved.</div>
      </div>
    </section>
  </main>;
}
