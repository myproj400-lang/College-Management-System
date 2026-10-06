import { useEffect, useState } from 'react';
import { api } from '../api';
import { useSession } from '../session';
import { Notice, Page, useForm } from '../ui';

type Term = { id: string; academicYear: string; semester: number; isCurrent: boolean; startDate: string; endDate: string; maxCredits: number };
type Enrolment = { id: string; academicYear: string; semester: number; status: string; course: { code: string; title: string }; student: { studentNumber: string; user: { firstName: string; lastName: string } } };
type NoticeItem = { id: string; title: string; body: string };

function iso(value: FormDataEntryValue | null) {
  return new Date(String(value)).toISOString();
}

export function TermsPage() {
  const { token, user } = useSession();
  const [rows, setRows] = useState<Term[]>([]);
  const form = useForm(async (data) => {
    await api(token).post('/terms', {
      academicYear: data.get('academicYear'),
      semester: Number(data.get('semester')),
      startDate: iso(data.get('startDate')),
      endDate: iso(data.get('endDate')),
      registrationOpensAt: iso(data.get('registrationOpensAt')),
      registrationClosesAt: iso(data.get('registrationClosesAt')),
      maxCredits: Number(data.get('maxCredits')),
    });
    setRows(await api(token).get('/terms'));
  });
  useEffect(() => { api(token).get<Term[]>('/terms').then(setRows).catch(() => setRows([])); }, [token]);
  return (
    <Page title="Academic terms" lede="A term holds the registration window and the credit limit.">
      <div className="grid">
        <table>
          <thead><tr><th>Year</th><th>Semester</th><th>Credits</th><th>Current</th><th></th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.academicYear}</td>
                <td>{row.semester}</td>
                <td>{row.maxCredits}</td>
                <td>{row.isCurrent ? 'Current' : 'No'}</td>
                <td>{(user?.role === 'ADMIN' || user?.role === 'REGISTRAR') && !row.isCurrent && <button className="secondary" onClick={async () => { await api(token).post(`/terms/${row.id}/set-current`); setRows(await api(token).get('/terms')); }}>Set current</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {(user?.role === 'ADMIN' || user?.role === 'REGISTRAR') && (
          <form className="card" onSubmit={form.onSubmit}>
            <h3>Add a term</h3>
            <Notice error={form.error} message={form.done} />
            <label>Academic year<input name="academicYear" placeholder="2026/2027" required /></label>
            <label>Semester<input name="semester" type="number" min={1} max={3} defaultValue={1} required /></label>
            <label>Starts<input name="startDate" type="date" required /></label>
            <label>Ends<input name="endDate" type="date" required /></label>
            <label>Registration opens<input name="registrationOpensAt" type="datetime-local" required /></label>
            <label>Registration closes<input name="registrationClosesAt" type="datetime-local" required /></label>
            <label>Maximum credits<input name="maxCredits" type="number" min={1} max={60} defaultValue={24} required /></label>
            <button disabled={form.pending}>Save term</button>
          </form>
        )}
      </div>
    </Page>
  );
}

export function EnrolmentsPage() {
  const { token } = useSession();
  const [rows, setRows] = useState<Enrolment[]>([]);
  const [error, setError] = useState<unknown>();
  useEffect(() => { api(token).get<Enrolment[]>('/enrollments').then(setRows).catch(setError); }, [token]);
  return (
    <Page title="Enrolments" lede="These are course registrations already stored. Students see their own rows.">
      <Notice error={error} />
      <table>
        <thead><tr><th>Student</th><th>Course</th><th>Term</th><th>Status</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.id}><td>{row.student.studentNumber} {row.student.user.firstName} {row.student.user.lastName}</td><td>{row.course.code} {row.course.title}</td><td>{row.academicYear} / {row.semester}</td><td><span className="pill">{row.status}</span></td></tr>)}</tbody>
      </table>
    </Page>
  );
}

export function NoticesPage() {
  const { token, user } = useSession();
  const [rows, setRows] = useState<NoticeItem[]>([]);
  const form = useForm(async (data) => {
    await api(token).post('/announcements', { title: data.get('title'), body: data.get('body') });
    setRows(await api(token).get('/announcements'));
  });
  useEffect(() => { api(token).get<NoticeItem[]>('/announcements').then(setRows).catch(() => setRows([])); }, [token]);
  const canPost = user?.role === 'ADMIN' || user?.role === 'REGISTRAR' || user?.role === 'BURSAR';
  return (
    <Page title="Notices" lede="Notices shown to you. A new notice is visible to everyone until an audience is added later.">
      <div className="grid">
        <div className="stack">{rows.map((row) => <article className="card" key={row.id}><h3>{row.title}</h3><p>{row.body}</p></article>)}{rows.length === 0 && <p className="muted">No notices.</p>}</div>
        {canPost && (
          <form className="card" onSubmit={form.onSubmit}>
            <h3>Post a notice</h3>
            <Notice error={form.error} message={form.done} />
            <label>Title<input name="title" required minLength={3} /></label>
            <label>Message<textarea name="body" required /></label>
            <button disabled={form.pending}>Publish notice</button>
          </form>
        )}
      </div>
    </Page>
  );
}
