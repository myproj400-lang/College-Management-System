import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Icon } from '../icons';
import { useSession } from '../session';
import { Page } from '../ui';

type Summary = {
  students: { byStatus: Record<string, number>; activeByProgramme: { programme?: { name: string }; count: number }[] };
  staff: number;
  courses: number;
};
type Notice = { id: string; title: string; body: string; publishedAt?: string; createdBy?: { firstName: string; lastName: string } };
type AppRow = { id: string; state: string; reference: string | null; programme: { name: string }; applicant?: { firstName: string; lastName: string } };
type Activity = { id: string; createdAt: string; action: string; entity: string; actor?: { firstName: string; lastName: string } | null };
type TeachingSlot = { id: string; dayOfWeek: number; startTime: string; endTime: string; room: string; course: { id: string; code: string; title: string } };

function countStatus(summary: Summary | null, status: string) {
  return summary?.students.byStatus[status] ?? 0;
}

export function HomePage() {
  const { token, user } = useSession();
  const role = user?.role;
  const [summary, setSummary] = useState<Summary | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [apps, setApps] = useState<AppRow[]>([]);
  const [term, setTerm] = useState('No current term');
  const [courses, setCourses] = useState<{ id: string; code: string; title: string }[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [schedule, setSchedule] = useState<TeachingSlot[]>([]);
  const [enrolled, setEnrolled] = useState<{ id: string; status: string; course: { id: string; code: string; title: string } }[]>([]);

  useEffect(() => {
    const client = api(token);
    client.get<Notice[]>('/announcements').then(setNotices).catch(() => setNotices([]));
    client.get<{ academicYear: string; semester: number }>('/terms/current')
      .then((item) => {
        setTerm(`${item.academicYear} · Semester ${item.semester}`);
        const owner = role === 'LECTURER' && user?.staff?.id ? `/staff/${user.staff.id}` : role === 'STUDENT' && user?.student?.id ? `/students/${user.student.id}` : null;
        if (owner) client.get<TeachingSlot[]>(`${owner}/timetable?academicYear=${encodeURIComponent(item.academicYear)}&semester=${item.semester}`).then(setSchedule).catch(() => setSchedule([]));
      })
      .catch(() => setTerm('No current term'));
    if (role === 'ADMIN' || role === 'REGISTRAR' || role === 'BURSAR') {
      client.get<Summary>('/reports/summary').then(setSummary).catch(() => setSummary(null));
    }
    if (role === 'ADMIN') client.get<{ items: Activity[] }>('/audit-logs?pageSize=5').then((result) => setActivity(result.items)).catch(() => setActivity([]));
    if (role === 'ADMISSIONS_OFFICER' || role === 'REGISTRAR' || role === 'BURSAR' || role === 'APPLICANT' || role === 'STUDENT') {
      client.get<{ items: AppRow[] }>('/admissions/applications').then((result) => setApps(result.items)).catch(() => setApps([]));
    }
    if (role === 'LECTURER' && user?.staff?.id) {
      client.get<{ id: string; code: string; title: string }[]>(`/courses?lecturerId=${user.staff.id}`).then(setCourses).catch(() => setCourses([]));
    }
    if (role === 'STUDENT') client.get<typeof enrolled>('/enrollments').then(setEnrolled).catch(() => setEnrolled([]));
  }, [token, role, user?.staff?.id, user?.student?.id]);

  const active = countStatus(summary, 'ACTIVE');
  const waiting = apps.filter((item) => item.state === 'SUBMITTED' || item.state === 'UNDER_REVIEW').length;
  const offered = apps.filter((item) => item.state === 'OFFERED' || item.state === 'ACCEPTED').length;
  const today = new Date().getUTCDay() || 7;
  const todaySchedule = schedule.filter((slot) => slot.dayOfWeek === today);

  if (role === 'APPLICANT') {
    const mine = apps[0];
    return (
      <Page title="Track your application" lede="Check the progress of your application. Counts below are the applications on your account.">
        <div className="stats">
          <Stat icon="file" label="Applications" value={String(apps.length)} note={mine ? mine.programme.name : 'No application yet'} />
          <Stat icon="clock" label="In review" value={String(waiting)} note="Submitted or under review" />
          <Stat icon="check" label="Offers" value={String(offered)} note="Offered or accepted" />
          <Stat icon="bell" label="Notices" value={String(notices.length)} note="Visible to you" />
        </div>
        <div className="card">
          {mine ? <Link to={`/applications/${mine.id}`}>Open {mine.reference ?? 'your draft'}</Link> : <Link to="/intakes">Choose an open intake</Link>}
          <p className="muted">{mine?.state.replaceAll('_', ' ') ?? 'You have not started an application.'}</p>
        </div>
      </Page>
    );
  }

  if (role === 'LECTURER') {
    return (
      <Page title={`Good morning, ${user?.firstName}`} lede="Here is what is on your teaching record." action={<span className="pill neutral">{term}</span>}>
        <div className="stats">
          <Stat icon="book" label="Assigned courses" value={String(courses.length)} note="Courses linked to your staff record" />
          <Stat icon="users" label="Students" value="—" note="Open a class gradebook for the roll" />
          <Stat icon="file" label="College notices" value={String(notices.length)} note="Latest announcements" />
          <Stat icon="calendar" label="Classes today" value={String(todaySchedule.length)} note="Scheduled teaching sessions" />
        </div>
        <div className="layout">
          <section className="card">
            <h3>Today’s teaching</h3>
            {todaySchedule.length === 0 && <p className="muted">No teaching sessions scheduled for today.</p>}
            {todaySchedule.map((slot, index) => <article className="teaching-card" key={slot.id}><img src={`/images/${index % 2 ? 'database' : 'software'}-class.png`} alt="" /><div><small>{slot.startTime} – {slot.endTime}</small><h3>{slot.course.title}</h3><p>{slot.course.code}</p><p className="muted">{slot.room}</p><Link className="button" to={`/gradebook?courseId=${slot.course.id}`}>Open gradebook <Icon name="arrow" /></Link></div></article>)}
            <h3 style={{ marginTop: 24 }}>My classes</h3>
            <div className="class-grid">{courses.map((course) => <Link className="class-tile" key={course.id} to={`/gradebook?courseId=${course.id}`}><Icon name="book" /><strong>{course.code}</strong><span>{course.title}</span><Icon name="chevron" /></Link>)}</div>
            {courses.length === 0 && <p className="muted">No course is assigned to you yet.</p>}
          </section>
          <NoticesCard notices={notices} />
        </div>
      </Page>
    );
  }

  if (role === 'STUDENT') {
    return (
      <section className="page"><div className="student-banner"><span className="eyebrow">Student portal</span><h2>Good morning, {user?.firstName} 👋</h2><p>Stay focused. Keep learning. You’re building something great.</p><a className="button" href="#today-schedule"><Icon name="calendar" />View timetable <Icon name="arrow" /></a><img src="/images/student-books.png" alt="Books and a growing plant" /></div><div className="student-dashboard"><div className="stack"><section className="card stack"><div className="card-title"><Icon name="cap" /><h3>Next class</h3></div>{todaySchedule[0] ? <div className="next-class"><h3>{todaySchedule[0].course.title}</h3><p className="muted">{todaySchedule[0].course.code}</p><p>{todaySchedule[0].startTime} – {todaySchedule[0].endTime} · {todaySchedule[0].room}</p></div> : <p className="muted">No classes scheduled for today.</p>}<Link className="button" to="/courses">View my courses <Icon name="arrow" /></Link></section><section className="card stack"><div className="card-title"><Icon name="calendar" /><h3>Registration</h3></div><p className="muted">Choose courses and review your registration for the current term.</p><p>{term}</p><Link className="button" to="/registration">Open registration <Icon name="arrow" /></Link></section></div><div className="stack"><section className="card" id="today-schedule"><div className="card-title"><Icon name="calendar" /><h3>Today’s schedule</h3></div>{todaySchedule.length ? todaySchedule.map((slot) => <div className="schedule-row" key={slot.id}><span>{slot.startTime} – {slot.endTime}</span><div><strong>{slot.course.title}</strong><p className="muted">{slot.room}</p></div></div>) : <p className="muted">No classes scheduled today.</p>}</section><section className="card stack"><div className="card-title"><Icon name="chart" /><h3>My progress</h3></div><div className="progress-grid"><div><b>{enrolled.filter((item) => item.status !== 'DROPPED').length}</b><p className="muted">Enrolled courses</p><Link to="/courses">View my courses →</Link></div><div><Icon name="chart" /><p className="muted">Academic results</p><Link to="/results">View results →</Link></div></div></section></div><NoticesCard notices={notices} /></div></section>
    );
  }

  const max = Math.max(1, ...(summary?.students.activeByProgramme.map((item) => item.count) ?? [1]));
  return (
    <Page
      title={role === 'ADMISSIONS_OFFICER' ? 'Applications' : 'College overview'}
      lede={`Key information and activity across ICMS${term === 'No current term' ? '.' : ` for ${term.split(' · ')[0]}.`}`}
      action={<div className="year-picker">Academic year <span><Icon name="calendar" />{term.split(' · ')[0]}<Icon name="down" /></span></div>}
    >
      <div className="stats">
        <Stat icon="users" label="Students" value={summary ? active.toLocaleString() : '—'} note="Active student records" />
        <Stat icon="file" label="Applications" value={role === 'ADMIN' ? '—' : String(apps.length)} note={role === 'ADMIN' ? 'Admissions officer access' : `${waiting} awaiting review`} />
        <Stat icon="book" label="Active courses" value={summary ? String(summary.courses) : '—'} note="Current course records" />
        <Stat icon="cap" label="Lecturers" value={summary ? String(summary.staff) : '—'} note="Current staff records" />
      </div>
      <div className="layout-3 overview-panels">
        <section className="card">
          <CardTitle icon="chart" title="Admissions trend" description="Monthly applications and enrolled students." />
          <div className="chart-legend"><span><i />Applications</span><span><i />Enrolled students</span></div>
          <TrendChart />
          <p className="muted" style={{ fontSize: 12 }}>Monthly admissions reporting is not available yet.</p>
        </section>
        <section className="card">
          <CardTitle icon="book" title="Programme enrolment" description="Total active enrolled students by programme." />
          <div className="bars">
            {(summary?.students.activeByProgramme ?? []).length === 0 && <p className="muted">No active enrolments by programme yet.</p>}
            {summary?.students.activeByProgramme.map((item) => (
              <div className="bar-row" key={item.programme?.name ?? item.count}>
                <span>{item.programme?.name ?? 'Programme'}</span>
                <div className="bar"><span style={{ width: `${(item.count / max) * 100}%` }} /></div>
                <strong>{item.count}</strong>
              </div>
            ))}
          </div>
        </section>
        <section className="card">
          <CardTitle icon="warning" title="Needs attention" description="Items requiring your review." />
          <Attention icon="file" title="Applications awaiting review" value={role === 'ADMIN' ? '—' : String(waiting)} description={role === 'ADMIN' ? 'Available to admissions officers.' : 'New applications to assess.'} to="/applications" />
          <Attention icon="chart" title="Academic results" description="Review term results and publication." to="/results" tone="gold" />
          <Attention icon="calendar" title="Attendance records" description="View recorded class attendance." to="/attendance" tone="rose" />
        </section>
      </div>
      <section className="card activity-card">
        <CardTitle icon="clock" title={role === 'ADMIN' ? 'Recent administrative activity' : 'Recent notices'} description="Latest actions across the system." />
        <div className="table-card">
          <table>
            <thead><tr><th>Date &amp; time</th><th>User</th><th>Action</th><th>Details</th></tr></thead>
            <tbody>
              {role === 'ADMIN' && activity.length === 0 && <tr><td colSpan={4}>No administrative activity yet.</td></tr>}
              {role === 'ADMIN' && activity.map((item) => <tr key={item.id}><td>{new Date(item.createdAt).toLocaleString('en-GB', { timeZone: 'Africa/Freetown', dateStyle: 'medium', timeStyle: 'short' })}</td><td>{item.actor ? `${item.actor.firstName} ${item.actor.lastName}` : 'System'}</td><td>{item.action.replaceAll('.', ' ')}</td><td>{item.entity}</td></tr>)}
              {role !== 'ADMIN' && notices.length === 0 && <tr><td colSpan={4}>No notices yet.</td></tr>}
              {role !== 'ADMIN' && notices.map((notice) => (
                <tr key={notice.id}>
                  <td>{notice.publishedAt ? new Date(notice.publishedAt).toLocaleString() : '—'}</td>
                  <td>{notice.createdBy ? `${notice.createdBy.firstName} ${notice.createdBy.lastName}` : 'Office'}</td>
                  <td>{notice.title}</td>
                  <td>{notice.body}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </Page>
  );
}

function Stat({ icon, label, value, note }: { icon: string; label: string; value: string; note: string }) {
  return (
    <article className="stat">
      <span className={`bubble ${icon === 'file' || icon === 'cap' ? 'gold' : ''}`}><Icon name={icon} /></span>
      <div>
        <small>{label}</small>
        <b>{value}</b>
        <small>{note}</small>
      </div>
    </article>
  );
}

function NoticesCard({ notices }: { notices: Notice[] }) {
  return (
    <section className="card stack">
      <h3>Announcements</h3>
      {notices.length === 0 && <p className="muted">No notices for you right now.</p>}
      {notices.map((notice) => (
        <article key={notice.id}>
          <strong>{notice.title}</strong>
          <p className="muted">{notice.body}</p>
        </article>
      ))}
    </section>
  );
}

function CardTitle({ icon, title, description }: { icon: string; title: string; description: string }) {
  return <div className="card-title"><span className={`bubble ${icon === 'warning' ? 'gold' : ''}`}><Icon name={icon} /></span><div><h3>{title}</h3><p>{description}</p></div></div>;
}

function Attention({ icon, title, value, description, to, tone = '' }: { icon: string; title: string; value?: string; description: string; to: string; tone?: string }) {
  return <div className="attention-item"><span className={`bubble ${tone}`}><Icon name={icon} /></span><div><strong>{title}</strong>{value && <b>{value}</b>}<p>{description}</p></div><Link to={to}>Review <Icon name="arrow" /></Link></div>;
}

function TrendChart() {
  // Keep unavailable reporting visibly empty rather than plotting invented counts.
  return <svg className="trend-chart" viewBox="0 0 480 270" role="img" aria-label="Admissions trend: monthly reporting is not available">
    {[0, 1, 2, 3, 4].map((row) => <g key={row}><line x1="35" x2="462" y1={25 + row * 45} y2={25 + row * 45} stroke="#e8eff0" /><text x="26" y={29 + row * 45} textAnchor="end" fontSize="10" fill="#52677f">{200 - row * 50}</text></g>)}
    {Array.from({ length: 13 }, (_, index) => <g key={index}><line x1={35 + index * 35.6} x2={35 + index * 35.6} y1="25" y2="205" stroke="#e8eff0" /><text x={35 + index * 35.6} y="228" textAnchor="middle" fontSize="10" fill="#52677f">{['Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'][index]}</text></g>)}
    <text x="250" y="120" textAnchor="middle" fontSize="13" fill="#738194">No reporting data available</text>
  </svg>;
}
