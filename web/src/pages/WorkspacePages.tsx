import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { Icon } from '../icons';
import { useSession } from '../session';
import { Notice, Page } from '../ui';

type Course = { id: string; code: string; title: string; creditHours: number; courseworkWeight?: number; lecturer?: { user: { firstName: string; lastName: string } } | null };
type Enrolment = {
  id: string;
  academicYear: string;
  semester: number;
  status: string;
  courseworkScore: number | null;
  examScore: number | null;
  score: number | null;
  grade: string | null;
  gradePoint: number | null;
  course: { id: string; code: string; title: string; creditHours: number };
  student: { id: string; studentNumber: string; user: { firstName: string; lastName: string } };
};
type Term = { id: string; academicYear: string; semester: number; isCurrent: boolean; resultsPublishedAt: string | null; maxCredits: number };

export function SetupPage() {
  const tiles = [
    ['/departments', 'Departments', 'Group programmes and courses.'],
    ['/programmes', 'Programmes', 'A programme belongs to one department.'],
    ['/courses', 'Courses', 'Course definitions used by registration.'],
    ['/terms', 'Academic terms', 'Registration window and result publication.'],
    ['/staff', 'Staff', 'Lecturer accounts and staff numbers.'],
    ['/users', 'Users', 'Office accounts and roles.'],
  ];
  return (
    <Page title="Academic setup" lede="Create the college structure before intakes, registration and teaching.">
      <div className="stats">
        {tiles.map(([to, title, lede]) => (
          <Link key={to} to={to} className="stat" style={{ color: 'inherit' }}>
            <span className="bubble" />
            <div><b style={{ fontSize: 22 }}>{title}</b><small>{lede}</small></div>
          </Link>
        ))}
      </div>
    </Page>
  );
}

export function RegistrationPage() {
  const { token, user } = useSession();
  const [courses, setCourses] = useState<Course[]>([]);
  const [term, setTerm] = useState<Term | null>(null);
  const [mine, setMine] = useState<Enrolment[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<unknown>();
  const [message, setMessage] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    const client = api(token);
    client.get<Course[]>('/courses').then(setCourses).catch(() => setCourses([]));
    client.get<Term>('/terms/current').then(setTerm).catch(() => setTerm(null));
    client.get<Enrolment[]>('/enrollments').then(setMine).catch(() => setMine([]));
  }, [token]);

  const credits = courses.filter((course) => picked.includes(course.id)).reduce((sum, course) => sum + course.creditHours, 0);

  async function submit() {
    setError(undefined);
    setMessage('');
    if (!term || !user?.student?.id) {
      setError(new Error('Registration needs a current term and a student record.'));
      return;
    }
    try {
      for (const courseId of picked) {
        await api(token).post('/enrollments', {
          studentId: user.student.id,
          courseId,
          academicYear: term.academicYear,
          semester: term.semester,
        });
      }
      setMessage('Registration submitted.');
      setPicked([]);
      setMine(await api(token).get('/enrollments'));
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Page title="Course registration" lede={term ? `${term.academicYear} · Semester ${term.semester}` : 'No current term has been set.'}>
      <Notice error={error} message={message} />
      <div className="steps"><span className="step on"><i>1</i>Choose courses</span><span className="step-line" /><span className="step"><i>2</i>Review</span><span className="step-line" /><span className="step"><i>3</i>Submit</span></div>
      <div className="layout">
        <section className="card">
          <h3>Available courses</h3>
          <label style={{ marginTop: 18 }}><input aria-label="Search available courses" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by course code, title or lecturer…" /></label>
          <div className="table-card">
          <table>
            <thead><tr><th></th><th>Code</th><th>Course title</th><th>Credits</th><th>Lecturer</th></tr></thead>
            <tbody>
              {courses.filter((course) => `${course.code} ${course.title} ${course.lecturer?.user.firstName ?? ''} ${course.lecturer?.user.lastName ?? ''}`.toLowerCase().includes(query.toLowerCase())).map((course) => (
                <tr key={course.id}>
                  <td><input type="checkbox" checked={picked.includes(course.id)} onChange={() => setPicked((list) => list.includes(course.id) ? list.filter((id) => id !== course.id) : [...list, course.id])} /></td>
                  <td>{course.code}</td>
                  <td><strong>{course.title}</strong></td>
                  <td>{course.creditHours}</td>
                  <td>{course.lecturer ? `${course.lecturer.user.firstName} ${course.lecturer.user.lastName}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <p className="muted" style={{ fontSize: 12 }}>Showing {courses.length} courses</p>
        </section>
        <aside className="card stack">
          <h3>Registration summary</h3>
          <div className="registration-counts"><div><b>{picked.length}</b><span className="muted">Courses selected</span></div><div><b>{credits}</b><span className="muted">Total credits</span></div></div>
          {term && <p className="muted">Credit limit: {term.maxCredits}</p>}
          <h3>Selected courses ({picked.length})</h3>
          <div>{courses.filter((course) => picked.includes(course.id)).map((course) => <div className="selected-course" key={course.id}><div><strong>{course.code}</strong> · {course.title}<small>{course.creditHours} credits</small></div><button aria-label={`Remove ${course.code}`} onClick={() => setPicked((list) => list.filter((id) => id !== course.id))}>×</button></div>)}</div>
          <h3>Already enrolled</h3>
          {mine.length === 0 && <p className="muted">No enrolments yet.</p>}
          {mine.map((row) => <p key={row.id}>{row.course.code} · {row.status}</p>)}
          <button disabled={!picked.length || user?.role !== 'STUDENT'} onClick={submit}>Submit registration <Icon name="arrow" /></button>
          {user?.role !== 'STUDENT' && <p className="muted">Students submit their own registration. Registry can add a student from the Students page.</p>}
        </aside>
      </div>
    </Page>
  );
}

export function GradebookPage() {
  const { token, user } = useSession();
  const [params, setParams] = useSearchParams();
  const [courses, setCourses] = useState<Course[]>([]);
  const [rows, setRows] = useState<Enrolment[]>([]);
  const [error, setError] = useState<unknown>();
  const [message, setMessage] = useState('');
  const courseId = params.get('courseId') ?? '';

  useEffect(() => {
    const path = user?.role === 'LECTURER' && user.staff?.id ? `/courses?lecturerId=${user.staff.id}` : '/courses';
    api(token).get<Course[]>(path).then(setCourses).catch(() => setCourses([]));
  }, [token, user]);

  useEffect(() => {
    if (!courseId) return;
    api(token).get<Enrolment[]>(`/enrollments?courseId=${courseId}`).then(setRows).catch(setError);
  }, [token, courseId]);

  const course = courses.find((item) => item.id === courseId);
  const weight = course?.courseworkWeight ?? 40;

  async function save(row: Enrolment, coursework: string, exam: string) {
    setError(undefined);
    setMessage('');
    try {
      await api(token).put(`/enrollments/${row.id}/grade`, { courseworkScore: Number(coursework), examScore: Number(exam) });
      setMessage('Marks saved.');
      setRows(await api(token).get(`/enrollments?courseId=${courseId}`));
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Page title="Course gradebook" lede={course ? `${course.code} — ${course.title}` : 'Choose a class. Marks use that course’s coursework weight.'}>
      <Notice error={error} message={message} />
      <label>Class
        <select value={courseId} onChange={(event) => setParams({ courseId: event.target.value })}>
          <option value="">Choose a course</option>
          {courses.map((item) => <option key={item.id} value={item.id}>{item.code} — {item.title}</option>)}
        </select>
      </label>
      {course && <section className="card assessment"><h3>Assessment setup</h3><p className="muted">This course uses {weight}% continuous coursework and {100 - weight}% final exam. Enter marks out of 100 below.</p><div className="assessment-grid"><div className="assessment-item"><Icon name="file" /><div><strong>Coursework</strong><b>{weight}%</b><p>Of the final grade</p></div><ul><li>Assignments</li><li>Class tests</li><li>Practical work</li></ul></div><div className="assessment-item"><Icon name="file" /><div><strong>Exam</strong><b>{100 - weight}%</b><p>Of the final grade</p></div><ul><li>Final written exam</li></ul></div></div></section>}
      <section className="card"><h3>Draft marks</h3><p className="muted">Enter and review marks for each student. Save your changes regularly.</p><div className="table-card">
        <table>
          <thead><tr><th>Student name</th><th>Student ID</th><th>Coursework / 100</th><th>Exam / 100</th><th>Total / 100</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <GradeRow key={row.id} row={row} onSave={save} />
            ))}
          </tbody>
        </table>
      </div>
      {courseId && rows.length === 0 && <p className="muted">No students are enrolled on this course.</p>}
      </section>
    </Page>
  );
}

function GradeRow({ row, onSave }: { row: Enrolment; onSave: (row: Enrolment, coursework: string, exam: string) => void }) {
  const [coursework, setCoursework] = useState(row.courseworkScore?.toString() ?? '');
  const [exam, setExam] = useState(row.examScore?.toString() ?? '');
  return (
    <tr>
      <td><strong>{row.student.user.firstName} {row.student.user.lastName}</strong></td>
      <td>{row.student.studentNumber}</td>
      <td><input aria-label={`Coursework mark for ${row.student.user.firstName} ${row.student.user.lastName}`} type="number" min="0" max="100" value={coursework} onChange={(event) => setCoursework(event.target.value)} inputMode="decimal" /></td>
      <td><input aria-label={`Exam mark for ${row.student.user.firstName} ${row.student.user.lastName}`} type="number" min="0" max="100" value={exam} onChange={(event) => setExam(event.target.value)} inputMode="decimal" /></td>
      <td>{row.score ?? '—'}</td>
      <td>{row.grade ? <span className="pill">{row.grade}</span> : <span className="pill warn">Missing mark</span>}</td>
      <td><button className="secondary" onClick={() => onSave(row, coursework, exam)}>Save</button></td>
    </tr>
  );
}

export function ResultsPage() {
  const { token, user } = useSession();
  const [terms, setTerms] = useState<Term[]>([]);
  const [error, setError] = useState<unknown>();
  const [message, setMessage] = useState('');
  const [transcript, setTranscript] = useState<{ cgpa: number | null; standing: string; terms: { term: string; gpa: number | null; credits: number; resultsPublished: boolean; courses: { code: string; title: string; creditHours: number; grade: string | null; gradePoint: number | null }[] }[] } | null>(null);

  useEffect(() => {
    api(token).get<Term[]>('/terms').then(setTerms).catch(() => setTerms([]));
    if (user?.student?.id) {
      api(token).get<typeof transcript>(`/students/${user.student.id}/transcript`).then(setTranscript).catch(setError);
    }
  }, [token, user?.student?.id]);

  const published = useMemo(() => terms.filter((term) => term.resultsPublishedAt), [terms]);

  return (
    <Page title={user?.role === 'STUDENT' ? 'Academic results' : 'Publish academic results'} lede={user?.role === 'STUDENT' ? 'View your semester results, GPA and course performance.' : 'Review academic terms and publish results to eligible students.'}>
      <Notice error={error} message={message} />
      {user?.role === 'STUDENT' && transcript && (
        <div className="stack">
          <div className="stats result-stats">
            <article className="stat"><span className="bubble"><Icon name="cap" /></span><div><small>Cumulative GPA</small><b>{transcript.cgpa?.toFixed(2) ?? '—'}</b><small>{transcript.standing}</small></div></article>
            <article className="stat"><span className="bubble"><Icon name="book" /></span><div><small>Published credits</small><b>{transcript.terms.reduce((sum, term) => sum + term.credits, 0)}</b></div></article>
            <article className="stat"><span className="bubble"><Icon name="file" /></span><div><small>Published courses</small><b>{transcript.terms.reduce((sum, term) => sum + term.courses.length, 0)}</b></div></article>
          </div>
          {transcript.terms.map((term) => (
            <section className="card" key={term.term}><h3>Course results</h3><p className="muted">{term.term} · Semester GPA {term.gpa?.toFixed(2) ?? '—'}</p><div className="table-card">
              <table className="result-table">
                <thead><tr><th>Course</th><th>Credits</th><th>Grade</th><th>Grade points</th></tr></thead>
                <tbody>
                  {term.courses.map((course) => (
                    <tr key={course.code}><td>{course.code} {course.title}</td><td>{course.creditHours}</td><td>{course.grade ?? '—'}</td><td>{course.gradePoint ?? '—'}</td></tr>
                  ))}
                </tbody>
              </table>
            </div></section>
          ))}
          {transcript.terms.length === 0 && <p className="muted">No published results yet.</p>}
        </div>
      )}
      {user?.role !== 'STUDENT' && (
        <div className="layout"><section className="card"><h3>Academic terms</h3><div className="table-card">
          <table>
            <thead><tr><th>Term</th><th>Semester</th><th>Publication</th><th></th></tr></thead>
            <tbody>
              {terms.map((term) => (
                <tr key={term.id}>
                  <td>{term.academicYear}</td>
                  <td>{term.semester}</td>
                  <td>{term.resultsPublishedAt ? <span className="pill">Published</span> : <span className="pill warn">Not published</span>}</td>
                  <td>{(user?.role === 'ADMIN' || user?.role === 'REGISTRAR') && !term.resultsPublishedAt && (
                    <button onClick={async () => {
                      setError(undefined);
                      try {
                        await api(token).post(`/terms/${term.id}/publish-results`, {});
                        setMessage('Results published for this term.');
                        setTerms(await api(token).get('/terms'));
                      } catch (err) {
                        setError(err);
                      }
                    }}>Review and publish</button>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div></section><aside className="card stack"><h3>Publication summary</h3><div className="banner ok"><strong>{published.length}</strong> terms published</div><p className="muted">Published results become visible to eligible students in the student portal.</p><p className="muted">Review each term before publishing. Publication applies to all course results within the selected term.</p></aside></div>
      )}
      {user?.role !== 'STUDENT' && <p className="muted">{published.length} term(s) already published.</p>}
    </Page>
  );
}

export function AttendancePage() {
  const { token } = useSession();
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseId, setCourseId] = useState('');
  const [rows, setRows] = useState<{ id: string; date: string; status: string; enrollment: { student: { studentNumber: string; user: { firstName: string; lastName: string } } } }[]>([]);
  const [error, setError] = useState<unknown>();

  useEffect(() => { api(token).get<Course[]>('/courses').then(setCourses).catch(() => setCourses([])); }, [token]);
  useEffect(() => {
    if (!courseId) return;
    api(token).get<typeof rows>(`/courses/${courseId}/attendance`).then(setRows).catch(setError);
  }, [token, courseId]);

  return (
    <Page title="Attendance" lede="Class attendance already stored for a course. Campus check-in for lecturers is not part of this release.">
      <Notice error={error} />
      <label>Course
        <select value={courseId} onChange={(event) => setCourseId(event.target.value)}>
          <option value="">Choose a course</option>
          {courses.map((course) => <option key={course.id} value={course.id}>{course.code} — {course.title}</option>)}
        </select>
      </label>
      <div className="table-card">
        <table>
          <thead><tr><th>Date</th><th>Student</th><th>Status</th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{new Date(row.date).toLocaleDateString()}</td>
                <td>{row.enrollment.student.studentNumber} {row.enrollment.student.user.firstName} {row.enrollment.student.user.lastName}</td>
                <td><span className="pill">{row.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {courseId && rows.length === 0 && <p className="muted">No attendance has been recorded for this course.</p>}
    </Page>
  );
}

export function StudentRecordPage() {
  const { token } = useSession();
  const [params] = useSearchParams();
  const id = params.get('id') ?? '';
  const [student, setStudent] = useState<{
    studentNumber: string;
    status: string;
    yearOfStudy: number;
    phone: string | null;
    address: string | null;
    dateOfBirth: string | null;
    user: { firstName: string; lastName: string; email: string };
    programme: { name: string; code: string; department?: { name: string } };
  } | null>(null);
  const [error, setError] = useState<unknown>();

  useEffect(() => {
    if (!id) return;
    api(token).get<typeof student>(`/students/${id}`).then(setStudent).catch(setError);
  }, [token, id]);

  if (!id) return <Page title="Student record" lede="Open a student from the directory."><Link to="/students">Back to students</Link></Page>;
  return (
    <Page title="Student record" action={<Link to="/students">Back to students</Link>}>
      <Notice error={error} />
      {student && (
        <><section className="card record-hero"><span className="avatar">{student.user.firstName[0]}{student.user.lastName[0]}</span><div><h2>{student.user.firstName} {student.user.lastName} <span className="pill">{student.status}</span></h2><strong>Student ID: {student.studentNumber}</strong><p>{student.programme.name}</p><p>{student.user.email}</p></div></section><div className="layout">
          <section className="card">
            <div className="card-title"><Icon name="user" /><h3>Personal information</h3></div>
            <dl className="detail-list"><div><dt>Full name</dt><dd>{student.user.firstName} {student.user.lastName}</dd></div><div><dt>Student ID</dt><dd>{student.studentNumber}</dd></div><div><dt>Date of birth</dt><dd>{student.dateOfBirth ? new Date(student.dateOfBirth).toLocaleDateString('en-GB') : '—'}</dd></div><div><dt>Email address</dt><dd>{student.user.email}</dd></div><div><dt>Phone number</dt><dd>{student.phone ?? '—'}</dd></div><div><dt>Home address</dt><dd>{student.address ?? '—'}</dd></div></dl>
          </section>
          <section className="card">
            <div className="card-title"><Icon name="cap" /><h3>Academic information</h3></div>
            <dl className="detail-list"><div><dt>Programme</dt><dd>{student.programme.name}</dd></div><div><dt>Department</dt><dd>{student.programme.department?.name ?? '—'}</dd></div><div><dt>Level</dt><dd>Year {student.yearOfStudy}</dd></div><div><dt>Student status</dt><dd><span className="pill">{student.status}</span></dd></div></dl>
          </section>
        </div></>
      )}
    </Page>
  );
}
