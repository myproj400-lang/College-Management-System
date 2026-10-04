import { useState, type FormEvent, type ReactNode } from 'react';
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { errorText } from './api';
import { Icon, Mark } from './icons';
import { useSession } from './session';

export function Notice({ error, message }: { error?: unknown; message?: string }) {
  if (!error && !message) return null;
  return <div className={error ? 'banner error' : 'banner ok'} role="status">{error ? errorText(error) : message}</div>;
}

export function Page({ title, lede, action, children }: { title: string; lede?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="page">
      <div className="page-head">
        <div>
          <h2>{title}</h2>
          {lede && <p>{lede}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

const ROLE_LABEL: Record<string, string> = {
  ADMIN: 'Administrator',
  ADMISSIONS_OFFICER: 'Admissions officer',
  REGISTRAR: 'Registry officer',
  BURSAR: 'Bursar',
  LECTURER: 'Lecturer',
  STUDENT: 'Student',
  APPLICANT: 'Applicant',
};

type Item = { to: string; label: string; icon: string; end?: boolean };

const NAV: Record<string, Item[]> = {
  ADMIN: [
    { to: '/', label: 'Overview', icon: 'home', end: true },
    { to: '/applications', label: 'Admissions', icon: 'file' },
    { to: '/students', label: 'Students', icon: 'users' },
    { to: '/setup', label: 'Academic setup', icon: 'book' },
    { to: '/courses', label: 'Learning', icon: 'screen' },
    { to: '/results', label: 'Results', icon: 'chart' },
    { to: '/attendance', label: 'Attendance', icon: 'calendar' },
    { to: '/users', label: 'Users', icon: 'user' },
  ],
  ADMISSIONS_OFFICER: [
    { to: '/', label: 'Dashboard', icon: 'home', end: true },
    { to: '/applications', label: 'Applications', icon: 'file' },
    { to: '/intakes', label: 'Intakes', icon: 'book' },
    { to: '/announcements', label: 'Notices', icon: 'bell' },
  ],
  REGISTRAR: [
    { to: '/', label: 'Overview', icon: 'home', end: true },
    { to: '/students', label: 'Students', icon: 'users' },
    { to: '/programmes', label: 'Programmes', icon: 'book' },
    { to: '/courses', label: 'Course offerings', icon: 'screen' },
    { to: '/registration', label: 'Registration', icon: 'calendar' },
    { to: '/results', label: 'Results', icon: 'chart' },
    { to: '/applications', label: 'Admissions', icon: 'file' },
  ],
  BURSAR: [
    { to: '/', label: 'Overview', icon: 'home', end: true },
    { to: '/students', label: 'Students', icon: 'users' },
    { to: '/applications', label: 'Applications', icon: 'file' },
    { to: '/enrollments', label: 'Enrolments', icon: 'book' },
  ],
  LECTURER: [
    { to: '/', label: 'Overview', icon: 'home', end: true },
    { to: '/courses', label: 'My classes', icon: 'book' },
    { to: '/gradebook', label: 'Gradebook', icon: 'chart' },
    { to: '/attendance', label: 'Attendance', icon: 'calendar' },
    { to: '/announcements', label: 'Notices', icon: 'bell' },
  ],
  STUDENT: [
    { to: '/', label: 'Dashboard', icon: 'home', end: true },
    { to: '/courses', label: 'My courses', icon: 'book' },
    { to: '/registration', label: 'Registration', icon: 'calendar' },
    { to: '/enrollments', label: 'Assignments', icon: 'file' },
    { to: '/results', label: 'Results', icon: 'chart' },
    { to: '/announcements', label: 'Notices', icon: 'bell' },
  ],
  APPLICANT: [
    { to: '/', label: 'Overview', icon: 'home', end: true },
    { to: '/applications', label: 'My application', icon: 'file' },
    { to: '/intakes', label: 'Intakes', icon: 'book' },
    { to: '/announcements', label: 'Help', icon: 'bell' },
  ],
};

function initials(first?: string, last?: string) {
  return `${first?.[0] ?? ''}${last?.[0] ?? ''}`.toUpperCase() || 'IC';
}

export function Shell() {
  const { user, ready, logout } = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const [menu, setMenu] = useState(false);
  const [query, setQuery] = useState('');
  if (!ready) return <p className="muted" style={{ padding: 24 }}>Loading your account…</p>;
  if (!user && location.pathname !== '/intakes') return <Navigate to="/login" replace />;
  if (!user) {
    return (
      <div className="login">
        <header className="login-nav">
          <div className="brand"><Mark /><div><strong>ICMS</strong><span>Integrated College Management System</span></div></div>
          <nav>
            <NavLink to="/login">Sign in</NavLink>
            <NavLink to="/intakes">Admissions</NavLink>
          </nav>
        </header>
        <div style={{ padding: 28 }}><Outlet /></div>
      </div>
    );
  }
  const items = NAV[user.role] ?? NAV.ADMIN;
  return (
    <div className={`app role-${user.role.toLowerCase()}`}>
      <aside className="sidebar">
        <div className="brand">
          <Mark />
          <div>
            <strong>ICMS</strong>
            <span>Integrated College Management System</span>
          </div>
        </div>
        <nav>
          {items.map((item) => (
            <NavLink key={item.to + item.label} to={item.to} end={item.end}>
              <Icon name={item.icon} />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <img className="campus" src="/images/campus-linework.png" alt="" />
          <p>Knowledge · People · Progress</p>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <form
            className="search"
            onSubmit={(event) => {
              event.preventDefault();
              const term = query.trim();
              if (!term) return;
              if (user.role === 'APPLICANT' || user.role === 'STUDENT') navigate('/applications');
              else if (user.role === 'ADMISSIONS_OFFICER') navigate(`/applications`);
              else navigate(`/students?search=${encodeURIComponent(term)}`);
            }}
          >
            <Icon name="search" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search students, applications, courses..."
              aria-label="Search"
            />
          </form>
          <button className="bell" aria-label="Notices" onClick={() => navigate('/announcements')}><Icon name="bell" /><i /></button>
          <button className="who" aria-expanded={menu} aria-haspopup="true" onClick={() => setMenu((open) => !open)}>
            <span className="avatar">{initials(user.firstName, user.lastName)}</span>
            <span className="who-details">
              <strong>{user.firstName} {user.lastName}</strong>
              <span>{ROLE_LABEL[user.role] ?? user.role}</span>
            </span>
            <Icon name="down" />
          </button>
          {menu && <div className="menu"><button onClick={logout}>Sign out</button></div>}
        </header>
        <div className="content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}

export function useForm(action: (form: FormData) => Promise<void>) {
  const [error, setError] = useState<unknown>();
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState('');
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setError(undefined);
    setDone('');
    setPending(true);
    try {
      await action(form);
      setDone('Saved.');
      formElement.reset();
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  }
  return { error, pending, done, onSubmit, setDone, setError };
}
