import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { Icon } from '../icons';
import { useSession } from '../session';
import { Notice, Page, useForm } from '../ui';

type Programme = { id: string; name: string };
type Department = { id: string; name: string };
type Student = { id: string; studentNumber: string; status: string; yearOfStudy: number; user: { firstName: string; lastName: string; email: string }; programme?: { code: string } };
type Staff = { id: string; staffNumber: string; position: string; user: { firstName: string; lastName: string; email: string }; department?: { name: string } | null };

export function StudentsPage() {
  const { token, user } = useSession();
  const [params] = useSearchParams();
  const [rows, setRows] = useState<Student[]>([]);
  const [programmes, setProgrammes] = useState<Programme[]>([]);
  const form = useForm(async (data) => {
    await api(token).post('/students', {
      email: data.get('email'),
      password: data.get('password'),
      firstName: data.get('firstName'),
      lastName: data.get('lastName'),
      studentNumber: data.get('studentNumber'),
      programmeId: data.get('programmeId'),
      yearOfStudy: Number(data.get('yearOfStudy')),
    });
    const result = await api(token).get<{ items: Student[] }>('/students');
    setRows(result.items);
  });
  useEffect(() => {
    const client = api(token);
    const search = params.get('search');
    client.get<{ items: Student[] }>(`/students${search ? `?search=${encodeURIComponent(search)}` : ''}`).then((result) => setRows(result.items)).catch(() => setRows([]));
    client.get<Programme[]>('/programmes').then(setProgrammes).catch(() => setProgrammes([]));
  }, [token, params]);
  return (
    <Page title="Students" lede="Student numbers created here are entered by the registry. Admitted applicants receive a number when an offer is converted.">
      <div className="grid">
        <table>
          <thead><tr><th>Number</th><th>Name</th><th>Programme</th><th>Status</th></tr></thead>
          <tbody>{rows.map((row) => <tr key={row.id}><td>{row.studentNumber}</td><td><Link to={`/students/record?id=${row.id}`}>{row.user.firstName} {row.user.lastName}</Link></td><td>{row.programme?.code}</td><td><span className="pill">{row.status}</span></td></tr>)}</tbody>
        </table>
        {(user?.role === 'ADMIN' || user?.role === 'REGISTRAR') && (
          <form className="card" onSubmit={form.onSubmit}>
            <h3>Add a student directly</h3>
            <Notice error={form.error} message={form.done} />
            <label>First name<input name="firstName" required /></label>
            <label>Last name<input name="lastName" required /></label>
            <label>Email<input name="email" type="email" required /></label>
            <label>Password<input name="password" type="password" required /></label>
            <label>Student number<input name="studentNumber" required minLength={3} /></label>
            <label>Year of study<input name="yearOfStudy" type="number" min={1} max={8} defaultValue={1} required /></label>
            <label>Programme<select name="programmeId" required defaultValue=""><option value="" disabled>Choose</option>{programmes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <button disabled={form.pending}>Save student</button>
          </form>
        )}
      </div>
    </Page>
  );
}

export function StaffPage() {
  const { token, user } = useSession();
  const [rows, setRows] = useState<Staff[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const form = useForm(async (data) => {
    await api(token).post('/staff', {
      email: data.get('email'),
      password: data.get('password'),
      firstName: data.get('firstName'),
      lastName: data.get('lastName'),
      staffNumber: data.get('staffNumber'),
      position: data.get('position'),
      departmentId: data.get('departmentId') || undefined,
    });
    setRows(await api(token).get('/staff'));
  });
  useEffect(() => {
    const client = api(token);
    client.get<Staff[]>('/staff').then(setRows).catch(() => setRows([]));
    client.get<Department[]>('/departments').then(setDepartments).catch(() => setDepartments([]));
  }, [token]);
  return (
    <Page title="Staff" lede="Creating staff here also creates a lecturer sign-in.">
      <div className="grid">
        <table>
          <thead><tr><th>Number</th><th>Name</th><th>Position</th><th>Department</th></tr></thead>
          <tbody>{rows.map((row) => <tr key={row.id}><td>{row.staffNumber}</td><td>{row.user.firstName} {row.user.lastName}</td><td>{row.position}</td><td>{row.department?.name}</td></tr>)}</tbody>
        </table>
        {user?.role === 'ADMIN' && (
          <form className="card" onSubmit={form.onSubmit}>
            <h3>Add a lecturer</h3>
            <Notice error={form.error} message={form.done} />
            <label>First name<input name="firstName" required /></label>
            <label>Last name<input name="lastName" required /></label>
            <label>Email<input name="email" type="email" required /></label>
            <label>Password<input name="password" type="password" required /></label>
            <label>Staff number<input name="staffNumber" required /></label>
            <label>Position<input name="position" required /></label>
            <label>Department<select name="departmentId" defaultValue=""><option value="">None</option>{departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <button disabled={form.pending}>Save staff</button>
          </form>
        )}
      </div>
    </Page>
  );
}

export function UsersPage() {
  const { token } = useSession();
  const [rows, setRows] = useState<{ id: string; email: string; firstName: string; lastName: string; role: string; isActive: boolean }[]>([]);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('ALL');
  const [selected, setSelected] = useState('');
  const [adding, setAdding] = useState(false);
  const form = useForm(async (data) => {
    await api(token).post('/users', {
      email: data.get('email'),
      password: data.get('password'),
      firstName: data.get('firstName'),
      lastName: data.get('lastName'),
      role: data.get('role'),
    });
    const result = await api(token).get<{ items: typeof rows }>('/users');
    setRows(result.items);
  });
  useEffect(() => {
    api(token).get<{ items: typeof rows }>('/users').then((result) => setRows(result.items)).catch(() => setRows([]));
  }, [token]);
  const visible = rows.filter((row) => `${row.firstName} ${row.lastName} ${row.email} ${row.role}`.toLowerCase().includes(query.toLowerCase()) && (roleFilter === 'ALL' || row.role === roleFilter));
  const current = visible.find((row) => row.id === selected) ?? visible[0];
  return (
    <Page title="Users & permissions" lede="Manage system users, assign roles and control access to academic functions." action={<button onClick={() => setAdding((value) => !value)}>{adding ? 'Close' : '+ Add user'}</button>}>
      <div className="grid">
        <section className="card user-directory"><div className="card-title"><Icon name="users" /><h3>System users</h3></div><div className="row"><label><input aria-label="Search users" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search users by name or role…" /></label><label><select aria-label="Filter by role" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}><option value="ALL">All roles</option>{[...new Set(rows.map((row) => row.role))].map((role) => <option key={role} value={role}>{role.replaceAll('_', ' ')}</option>)}</select></label></div><div className="table-card"><table>
          <thead><tr><th>#</th><th>Name</th><th>Role</th><th>Status</th></tr></thead>
          <tbody>{visible.map((row, index) => <tr className={current?.id === row.id ? 'selected-row' : ''} key={row.id}><td>{index + 1}</td><td><button className="user-select" onClick={() => { setSelected(row.id); setAdding(false); }}><span className="avatar">{row.firstName[0]}{row.lastName[0]}</span><strong>{row.firstName} {row.lastName}</strong></button></td><td>{row.role.replaceAll('_', ' ')}</td><td><span className={row.isActive ? 'pill' : 'pill neutral'}>{row.isActive ? '● Active' : 'Inactive'}</span></td></tr>)}</tbody>
        </table></div>{visible.length === 0 && <p className="muted">No users match your search.</p>}</section>
        {adding ? <form className="card" onSubmit={form.onSubmit}>
          <h3>Add an office account</h3>
          <Notice error={form.error} message={form.done} />
          <label>First name<input name="firstName" required /></label>
          <label>Last name<input name="lastName" required /></label>
          <label>Email<input name="email" type="email" required /></label>
          <label>Password<input name="password" type="password" required /></label>
          <label>Role
            <select name="role" defaultValue="ADMISSIONS_OFFICER">
              <option value="ADMISSIONS_OFFICER">Admissions officer</option>
              <option value="REGISTRAR">Registrar</option>
              <option value="BURSAR">Bursar</option>
              <option value="ADMIN">Administrator</option>
            </select>
          </label>
          <button disabled={form.pending}>Save account</button>
        </form> : current ? <aside className="card stack"><div className="selected-person"><span className="avatar">{current.firstName[0]}{current.lastName[0]}</span><div><h3>{current.firstName} {current.lastName}</h3><span className="muted">{current.role.replaceAll('_', ' ')}</span></div></div><span className={current.isActive ? 'pill' : 'pill neutral'}>{current.isActive ? '● Active' : 'Inactive'}</span><div className="card-title"><Icon name="shield" /><h3>Access details</h3></div><dl className="detail-list"><div><dt>Role</dt><dd>{current.role.replaceAll('_', ' ')}</dd></div><div><dt>Email</dt><dd>{current.email}</dd></div></dl><div className="banner ok"><Icon name="shield" /><p>Access is controlled by the assigned role and the account status.</p></div><p className="muted">Create student and lecturer accounts through their respective directories.</p></aside> : <aside className="card"><h3>Access details</h3><p className="muted">Select a user to view their account.</p></aside>}
      </div>
    </Page>
  );
}
