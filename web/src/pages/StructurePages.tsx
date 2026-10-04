import { useEffect, useState } from 'react';
import { api } from '../api';
import { useSession } from '../session';
import { Notice, Page, useForm } from '../ui';

type Department = { id: string; code: string; name: string };
type Programme = { id: string; code: string; name: string; level: string; durationYears: number; department?: { name: string } };
type Course = { id: string; code: string; title: string; creditHours: number; semester: number; department?: { code: string } };

function canWrite(role?: string) {
  return role === 'ADMIN' || role === 'REGISTRAR';
}

export function DepartmentsPage() {
  const { token, user } = useSession();
  const [rows, setRows] = useState<Department[]>([]);
  const form = useForm(async (data) => {
    await api(token).post('/departments', { code: data.get('code'), name: data.get('name') });
    setRows(await api(token).get('/departments'));
  });
  useEffect(() => { api(token).get<Department[]>('/departments').then(setRows).catch(() => setRows([])); }, [token]);
  return (
    <Page title="Departments" lede="Departments group programmes and courses.">
      <div className="grid">
        <table>
          <thead><tr><th>Code</th><th>Name</th></tr></thead>
          <tbody>{rows.map((row) => <tr key={row.id}><td>{row.code}</td><td>{row.name}</td></tr>)}</tbody>
        </table>
        {canWrite(user?.role) && (
          <form className="card" onSubmit={form.onSubmit}>
            <h3>Add a department</h3>
            <Notice error={form.error} message={form.done} />
            <label>Code<input name="code" required minLength={2} /></label>
            <label>Name<input name="name" required minLength={2} /></label>
            <button disabled={form.pending}>Save department</button>
          </form>
        )}
      </div>
    </Page>
  );
}

export function ProgrammesPage() {
  const { token, user } = useSession();
  const [rows, setRows] = useState<Programme[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const form = useForm(async (data) => {
    await api(token).post('/programmes', {
      code: data.get('code'),
      name: data.get('name'),
      level: data.get('level'),
      durationYears: Number(data.get('durationYears')),
      departmentId: data.get('departmentId'),
    });
    setRows(await api(token).get('/programmes'));
  });
  useEffect(() => {
    const client = api(token);
    client.get<Programme[]>('/programmes').then(setRows).catch(() => setRows([]));
    client.get<Department[]>('/departments').then(setDepartments).catch(() => setDepartments([]));
  }, [token]);
  return (
    <Page title="Programmes" lede="A programme belongs to one department. Intakes offer a programme to applicants.">
      <div className="grid">
        <table>
          <thead><tr><th>Code</th><th>Name</th><th>Level</th><th>Years</th><th>Department</th></tr></thead>
          <tbody>{rows.map((row) => <tr key={row.id}><td>{row.code}</td><td>{row.name}</td><td>{row.level}</td><td>{row.durationYears}</td><td>{row.department?.name}</td></tr>)}</tbody>
        </table>
        {canWrite(user?.role) && (
          <form className="card" onSubmit={form.onSubmit}>
            <h3>Add a programme</h3>
            <Notice error={form.error} message={form.done} />
            <label>Code<input name="code" required /></label>
            <label>Name<input name="name" required /></label>
            <label>Level<input name="level" placeholder="Bachelor's" required /></label>
            <label>Duration in years<input name="durationYears" type="number" min={1} max={8} defaultValue={4} required /></label>
            <label>Department
              <select name="departmentId" required defaultValue=""><option value="" disabled>Choose</option>{departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
            </label>
            <button disabled={form.pending}>Save programme</button>
          </form>
        )}
      </div>
    </Page>
  );
}

export function CoursesPage() {
  const { token, user } = useSession();
  const [rows, setRows] = useState<Course[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const form = useForm(async (data) => {
    await api(token).post('/courses', {
      code: data.get('code'),
      title: data.get('title'),
      creditHours: Number(data.get('creditHours')),
      semester: Number(data.get('semester')),
      departmentId: data.get('departmentId'),
    });
    setRows(await api(token).get('/courses'));
  });
  useEffect(() => {
    const client = api(token);
    client.get<Course[]>('/courses').then(setRows).catch(() => setRows([]));
    client.get<Department[]>('/departments').then(setDepartments).catch(() => setDepartments([]));
  }, [token]);
  return (
    <Page title="Courses" lede="A course definition is separate from a particular intake. Lecturer assignment here is the current record on main.">
      <div className="grid">
        <table>
          <thead><tr><th>Code</th><th>Title</th><th>Credits</th><th>Semester</th><th>Department</th></tr></thead>
          <tbody>{rows.map((row) => <tr key={row.id}><td>{row.code}</td><td>{row.title}</td><td>{row.creditHours}</td><td>{row.semester}</td><td>{row.department?.code}</td></tr>)}</tbody>
        </table>
        {canWrite(user?.role) && (
          <form className="card" onSubmit={form.onSubmit}>
            <h3>Add a course</h3>
            <Notice error={form.error} message={form.done} />
            <label>Code<input name="code" required /></label>
            <label>Title<input name="title" required /></label>
            <label>Credit hours<input name="creditHours" type="number" min={1} max={12} defaultValue={3} required /></label>
            <label>Usual semester<input name="semester" type="number" min={1} max={3} defaultValue={1} required /></label>
            <label>Department
              <select name="departmentId" required defaultValue=""><option value="" disabled>Choose</option>{departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
            </label>
            <button disabled={form.pending}>Save course</button>
          </form>
        )}
      </div>
    </Page>
  );
}
