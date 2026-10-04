import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { api, errorText } from '../api';
import { Icon, Mark } from '../icons';
import { useSession } from '../session';

export function LoginPage() {
  const { user, login } = useSession();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [show, setShow] = useState(false);
  const [apply, setApply] = useState(false);
  if (user) return <Navigate to="/" replace />;

  return (
    <div className="login">
      <header className="login-nav">
        <div className="brand"><Mark /><div><strong>ICMS</strong><span>Integrated College Management System</span></div></div>
        <nav>
          <a href="#college-benefits">About</a>
          <Link to="/intakes">Admissions</Link>
          <Link to="/intakes">Help</Link>
          <button type="button" onClick={() => setApply(true)}>Apply now</button>
        </nav>
      </header>
      <div className="login-stage">
        <section className="hero-panel">
          <div className="hero-art" role="img" aria-label="College students studying together on campus" />
          <div className="hero-kicker">A brighter tomorrow together</div>
          <h1>Your college.<br />Connected.</h1>
          <p>Admissions, academics, finances and more — all in one place. ICMS brings students, faculty and staff together for a smarter, brighter college experience.</p>
          <div className="hero-pills"><span><Icon name="book" />Modern<br />Academics</span><span><Icon name="users" />A Connected<br />Community</span><span><Icon name="cap" />Real<br />Opportunities</span></div>
        </section>
        <section className="welcome">
          {apply ? <ApplyForm onBack={() => setApply(false)} /> : (
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                setError('');
                setPending(true);
                const data = new FormData(event.currentTarget);
                try {
                  await login(String(data.get('email')), String(data.get('password')));
                } catch (err) {
                  setError(errorText(err));
                } finally {
                  setPending(false);
                }
              }}
            >
              <h2>Welcome back</h2>
              <p className="muted">Sign in to your ICMS account to access your courses, applications and more.</p>
              {error && <div className="banner error" role="alert">{error}</div>}
              <label className="field">Email address
                <Icon name="mail" />
                <input name="email" type="email" autoComplete="username" placeholder="student@icms.edu" required />
              </label>
              <label className="field">Password
                <Icon name="lock" />
                <input name="password" type={show ? 'text' : 'password'} autoComplete="current-password" required />
                <button type="button" className="password-toggle" aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show} onClick={() => setShow((value) => !value)}><Icon name="eye" /></button>
              </label>
              <div style={{ textAlign: 'right', marginTop: -8 }}>
                <Link to="/intakes">Need help signing in?</Link>
              </div>
              <button disabled={pending} type="submit" className="sign-in">
                {pending ? 'Signing in…' : 'Sign in'} <Icon name="chevron" />
              </button>
              <p className="muted login-divider">or</p>
              <p className="login-new">
                <span className="muted">New applicant? </span><button type="button" className="ghost" onClick={() => setApply(true)}>Start your application <Icon name="arrow" /></button>
              </p>
            </form>
          )}
        </section>
      </div>
      <section className="login-foot" id="college-benefits">
        <article><span className="bubble"><Icon name="book" /></span><div><h3>Learn</h3><p>Access your courses, schedules and academic records.</p></div></article>
        <article><span className="bubble"><Icon name="users" /></span><div><h3>Connect</h3><p>Engage with faculty, classmates and campus life.</p></div></article>
        <article><span className="bubble"><Icon name="trophy" /></span><div><h3>Achieve</h3><p>Turn your goals into real opportunities.</p></div></article>
      </section>
    </div>
  );
}

function ApplyForm({ onBack }: { onBack: () => void }) {
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setError('');
        setMessage('');
        const data = new FormData(event.currentTarget);
        try {
          const result = await api().post<{ message: string }>('/auth/register-applicant', {
            email: data.get('email'),
            password: data.get('password'),
            firstName: data.get('firstName'),
            lastName: data.get('lastName'),
          });
          setMessage(result.message);
        } catch (err) {
          setError(errorText(err));
        }
      }}
    >
      <h2>Start your application</h2>
      <p className="muted">Create an applicant account. Email delivery is not connected, so verification cannot be completed yet.</p>
      {error && <div className="banner error">{error}</div>}
      {message && <div className="banner info">{message} No email service is connected, so the verification step cannot be delivered yet.</div>}
      <label>First name<input name="firstName" required /></label>
      <label>Last name<input name="lastName" required /></label>
      <label>Email address<input name="email" type="email" required /></label>
      <label>Password<input name="password" type="password" minLength={8} required /><span className="muted">At least 8 characters, with a letter and a number.</span></label>
      <button type="submit" style={{ width: '100%', justifyContent: 'center' }}>Create applicant account</button>
      <p><button type="button" className="ghost" onClick={onBack}>Back to sign in</button></p>
    </form>
  );
}
