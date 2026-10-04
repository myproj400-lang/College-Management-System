import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { Icon } from '../icons';
import { useSession } from '../session';
import { Notice, Page, useForm } from '../ui';

type Programme = { id: string; name: string; code: string };
type Intake = {
  id: string;
  name: string;
  opensAt: string;
  closesAt: string;
  timezone: string;
  entryRequirements: string;
  feeInstructions: string;
  feeRequired: boolean;
  feeAmount: string | null;
  currency: string | null;
  programme: { name: string; code: string };
  isActive?: boolean;
};
type ApplicationSummary = {
  id: string;
  state: string;
  reference: string | null;
  feeStatus: string;
  submittedAt?: string | null;
  programme: { code: string; name: string };
  intake: { name: string };
  nextAction: string;
  applicant?: { firstName: string; lastName: string; email: string };
};
type ApplicationDetail = ApplicationSummary & {
  revision: number;
  draft: { dateOfBirth?: string; phone?: string; address?: string; acknowledgedDeclarationCodes?: string[] };
  paymentReference: string;
  offerDeadline: string | null;
  offerConditions: string | null;
  correctionMessage: string | null;
  correctionFields: string[];
  assignmentRevision?: number;
  requirementsMet: boolean;
  documents: { id: string; requirementCode: string; fileName: string; state: string }[];
  decisions: { id: string; kind: string; outcome: string; reason: string; createdAt?: string; internalNote?: string | null }[];
};

function when(value: string) {
  return new Date(value).toLocaleString();
}

export function IntakesPage() {
  const { token, user } = useSession();
  const [rows, setRows] = useState<Intake[]>([]);
  const [programmes, setProgrammes] = useState<Programme[]>([]);
  const [loadError, setLoadError] = useState<unknown>();
  const canManage = user?.role === 'ADMIN' || user?.role === 'ADMISSIONS_OFFICER';
  const form = useForm(async (data) => {
    await api(token).post('/admissions/intakes', {
      programmeId: data.get('programmeId'),
      name: data.get('name'),
      opensAt: new Date(String(data.get('opensAt'))).toISOString(),
      closesAt: new Date(String(data.get('closesAt'))).toISOString(),
      timezone: data.get('timezone'),
      entryRequirements: data.get('entryRequirements'),
      feeInstructions: data.get('feeInstructions'),
      feeRequired: data.get('feeRequired') === 'on',
      reviewBeforePayment: data.get('reviewBeforePayment') === 'on',
      feeAmount: data.get('feeAmount') ? Number(data.get('feeAmount')) : undefined,
      currency: data.get('currency') || undefined,
      requiredDocuments: String(data.get('documentCode') || '').trim()
        ? [{ code: String(data.get('documentCode')).trim(), label: String(data.get('documentLabel') || 'Document') }]
        : [],
      declarations: [{ code: 'TRUTH', text: String(data.get('declaration')) }],
      maxDocumentBytes: 500000,
      allowedContentTypes: ['application/pdf'],
      secondApprovalRequired: data.get('secondApprovalRequired') === 'on',
    });
    setRows(await api(token).get('/admissions/intakes'));
  });

  useEffect(() => {
    const path = user ? '/admissions/intakes' : '/admissions/public/intakes';
    api(token).get<Intake[]>(path).then(setRows).catch(setLoadError);
    if (canManage) api(token).get<Programme[]>('/programmes').then(setProgrammes).catch(() => setProgrammes([]));
  }, [token, user, canManage]);

  return (
    <Page title="Intakes" lede="An intake is one offering of a programme, with its own deadline, documents, and fee rule. Amounts you type here are the college's configuration, not a built-in tariff.">
      <Notice error={loadError} />
      {!user && <p><Link to="/login">Sign in</Link> to apply after an account is verified.</p>}
      <div className="grid">
        <div className="stack">
          {rows.length === 0 && <p className="muted">No intakes are open.</p>}
          {rows.map((row) => (
            <article className="card" key={row.id}>
              <h3>{row.name}</h3>
              <p>{row.programme.code} · {row.programme.name}</p>
              <p>Opens {when(row.opensAt)} · Closes {when(row.closesAt)} · {row.timezone}</p>
              <p>{row.entryRequirements}</p>
              <p>{row.feeInstructions}{row.feeRequired ? ` Fee ${row.feeAmount} ${row.currency}.` : ' No fee.'}</p>
              {(user?.role === 'APPLICANT' || user?.role === 'STUDENT') && (
                <ApplyButton intakeId={row.id} onDone={() => undefined} />
              )}
            </article>
          ))}
        </div>
        {canManage && (
          <form className="card" onSubmit={form.onSubmit}>
            <h3>Publish an intake</h3>
            <Notice error={form.error} message={form.done} />
            <label>Programme<select name="programmeId" required defaultValue=""><option value="" disabled>Choose</option>{programmes.map((item) => <option key={item.id} value={item.id}>{item.code} {item.name}</option>)}</select></label>
            <label>Name<input name="name" required /></label>
            <label>Opens<input name="opensAt" type="datetime-local" required /></label>
            <label>Closes<input name="closesAt" type="datetime-local" required /></label>
            <label>Timezone<input name="timezone" defaultValue="UTC" required /><span className="muted">The college timezone is not signed off. UTC is only a starting value.</span></label>
            <label>Entry requirements<textarea name="entryRequirements" required /></label>
            <label>Fee instructions<textarea name="feeInstructions" required /></label>
            <label className="check"><input name="feeRequired" type="checkbox" /> Fee is required before submission</label>
            <label className="check"><input name="reviewBeforePayment" type="checkbox" /> Review may start before payment</label>
            <div className="row">
              <label>Amount<input name="feeAmount" type="number" min="0" step="0.01" /></label>
              <label>Currency<input name="currency" maxLength={3} placeholder="SLE" /></label>
            </div>
            <div className="row">
              <label>Document code<input name="documentCode" placeholder="ID" /></label>
              <label>Document label<input name="documentLabel" placeholder="Identification" /></label>
            </div>
            <label>Declaration applicants must acknowledge<textarea name="declaration" required defaultValue="The information in this application is true." /></label>
            <label className="check"><input name="secondApprovalRequired" type="checkbox" /> A second officer must confirm the final decision</label>
            <button disabled={form.pending}>Publish intake</button>
          </form>
        )}
      </div>
    </Page>
  );
}

function ApplyButton({ intakeId }: { intakeId: string; onDone: () => void }) {
  const { token } = useSession();
  const [error, setError] = useState<unknown>();
  const [id, setId] = useState('');
  return (
    <div>
      <Notice error={error} />
      {id && <p><Link to={`/applications/${id}`}>Continue this application</Link></p>}
      <button onClick={async () => {
        setError(undefined);
        try {
          const created = await api(token).post<{ id: string }>('/admissions/applications', { intakeId });
          setId(created.id);
        } catch (err) {
          setError(err);
        }
      }}>Start application</button>
    </div>
  );
}

export function ApplicationsPage() {
  const { token, user } = useSession();
  const [rows, setRows] = useState<ApplicationSummary[]>([]);
  const [error, setError] = useState<unknown>();
  const [selected, setSelected] = useState<string>('');
  const [query, setQuery] = useState('');
  const [state, setState] = useState('ALL');
  useEffect(() => {
    api(token).get<{ items: ApplicationSummary[] }>('/admissions/applications').then((result) => {
      setRows(result.items);
      setSelected(result.items[0]?.id ?? '');
    }).catch(setError);
  }, [token]);
  const visible = rows.filter((row) => {
    const name = `${row.applicant?.firstName ?? ''} ${row.applicant?.lastName ?? ''} ${row.reference ?? ''} ${row.programme.name}`.toLowerCase();
    const matchesQuery = name.includes(query.toLowerCase());
    const matchesState = state === 'ALL' || row.state === state;
    return matchesQuery && matchesState;
  });
  const current = visible.find((row) => row.id === selected) ?? visible[0];
  const count = (name: string) => rows.filter((row) => row.state === name).length;
  return (
    <Page title="Applications" lede={user?.role === 'ADMIN' ? 'Administrators do not review applications. An admissions officer uses this queue.' : 'Manage applications currently stored for your role.'}>
      <Notice error={error} />
      <div className="stats">
        <article className="stat"><span className="bubble"><Icon name="users" /></span><div><small>New applications</small><b>{count('SUBMITTED')}</b></div></article>
        <article className="stat"><span className="bubble gold"><Icon name="file" /></span><div><small>In review</small><b>{count('UNDER_REVIEW')}</b></div></article>
        <article className="stat"><span className="bubble rose"><Icon name="warning" /></span><div><small>Action required</small><b>{count('CORRECTION_REQUESTED')}</b></div></article>
        <article className="stat"><span className="bubble"><Icon name="cap" /></span><div><small>Offers sent</small><b>{count('OFFERED') + count('ACCEPTED')}</b></div></article>
      </div>
      <div className="layout">
        <div className="table-card">
          <div className="row" style={{ padding: 12 }}>
            <select value={state} onChange={(event) => setState(event.target.value)}>
              <option value="ALL">All statuses</option>
              {['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'CORRECTION_REQUESTED', 'OFFERED', 'ACCEPTED', 'REJECTED', 'CONVERTED'].map((item) => <option key={item}>{item}</option>)}
            </select>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name or reference" />
          </div>
          <table>
            <thead><tr><th>Applicant</th><th>Programme</th><th>Submitted date</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.id} className={current?.id === row.id ? 'selected-row' : ''}>
                  <td><button className="application-select" onClick={() => setSelected(row.id)}><strong>{row.applicant ? `${row.applicant.firstName} ${row.applicant.lastName}` : 'Applicant'}</strong><span className="muted">{row.reference ?? 'Draft'}</span></button></td>
                  <td>{row.programme.name}</td>
                  <td>{row.submittedAt ? new Date(row.submittedAt).toLocaleDateString('en-GB') : '—'}</td>
                  <td><span className={row.state === 'CORRECTION_REQUESTED' ? 'pill warn' : 'pill'}>{row.state.replaceAll('_', ' ')}</span></td>
                  <td><Link className="button" to={`/applications/${row.id}`}>Review</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
          {visible.length === 0 && !error && <p className="muted" style={{ padding: 16 }}>No applications match.</p>}
        </div>
        {current && (
          <aside className="card stack">
            <h3>Selected application</h3>
            <div className="selected-person"><span className="avatar">{current.applicant?.firstName[0]}{current.applicant?.lastName[0]}</span><div><strong>{current.applicant ? `${current.applicant.firstName} ${current.applicant.lastName}` : 'Applicant'}</strong><p className="muted">{current.reference ?? 'Draft'}</p></div></div>
            <p className="detail-inline"><Icon name="mail" />{current.applicant?.email ?? 'Email unavailable'}</p>
            <p className="detail-inline"><Icon name="cap" />{current.programme.name}</p>
            <p className="detail-inline"><Icon name="calendar" />{current.intake.name}</p>
            <p>{current.nextAction}</p>
            <Link className="button" to={`/applications/${current.id}`}>Open application <Icon name="arrow" /></Link>
          </aside>
        )}
      </div>
    </Page>
  );
}

export function ApplicationPage() {
  const { id = '' } = useParams();
  const { token, user } = useSession();
  const [app, setApp] = useState<ApplicationDetail | null>(null);
  const [error, setError] = useState<unknown>();
  const [message, setMessage] = useState('');

  async function reload() {
    setApp(await api(token).get(`/admissions/applications/${id}`));
  }
  useEffect(() => { reload().catch(setError); }, [id, token]);

  async function run(work: () => Promise<unknown>) {
    setError(undefined);
    setMessage('');
    try {
      await work();
      setMessage('Saved.');
      await reload();
    } catch (err) {
      setError(err);
    }
  }

  if (!app) return <Page title="Application"><Notice error={error} /></Page>;
  const officer = user?.role === 'ADMISSIONS_OFFICER';
  const applicant = user?.role === 'APPLICANT' || user?.role === 'STUDENT';

  const stage = ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'OFFERED', 'ACCEPTED', 'CONVERTED'].indexOf(app.state);
  return (
    <Page title={applicant ? app.state === 'DRAFT' ? 'My application' : 'Track your application' : (app.reference ?? 'Draft application')} lede={applicant ? 'Check the progress of your application to ICMS. We will notify you at each stage.' : `${app.programme.name} · ${app.intake.name}`}>
      {applicant && (
        <div className="layout application-tracking"><div className="card"><div className="application-reference"><div><span className="muted">Application reference</span><strong>{app.reference ?? 'Draft application'}</strong></div><div><span className="muted">Programme applied for</span><strong>{app.programme.name}</strong></div><span className="pill warn">{app.state.replaceAll('_', ' ')}</span></div><div className="steps">
          {['Submitted', 'Document checks', 'Academic review', 'Decision'].map((label, index) => (
            <span key={label} style={{ display: 'contents' }}>
              {index > 0 && <span className={stage > index ? 'step-line done' : 'step-line'} />}
              <span className={stage >= index + 1 ? 'step done' : stage === index ? 'step on' : 'step'}><i>{index + 1}</i>{label}</span>
            </span>
          ))}
        </div><h3>Application timeline</h3><div className="application-timeline">{app.submittedAt && <article><span className="bubble"><Icon name="check" /></span><div><strong>Application submitted</strong><p className="muted">{when(app.submittedAt)}</p></div></article>}<article><span className="bubble"><Icon name="book" /></span><div><strong>{app.state.replaceAll('_', ' ')}</strong><p className="muted">{app.nextAction}</p></div></article>{app.decisions.map((decision) => <article key={decision.id}><span className="bubble"><Icon name="file" /></span><div><strong>{decision.outcome.replaceAll('_', ' ')}</strong><p className="muted">{decision.reason}</p></div></article>)}</div></div><aside className="card stack"><h3>Application summary</h3><div className="selected-person"><span className="avatar">{user?.firstName[0]}{user?.lastName[0]}</span><strong>{user?.firstName} {user?.lastName}</strong></div><dl className="detail-list"><div><dt>Reference</dt><dd>{app.reference ?? 'Draft'}</dd></div><div><dt>Programme</dt><dd>{app.programme.name}</dd></div><div><dt>Date submitted</dt><dd>{app.submittedAt ? new Date(app.submittedAt).toLocaleDateString('en-GB') : 'Not submitted'}</dd></div><div><dt>Status</dt><dd><span className="pill warn">{app.state.replaceAll('_', ' ')}</span></dd></div></dl><h3>Next step</h3><div className="banner ok">{app.nextAction}</div></aside></div>
      )}
      <Notice error={error} message={message} />
      <div className="grid">
        <div className="card stack">
          <p><span className="pill">{app.state.replaceAll('_', ' ')}</span> Fee: {app.feeStatus.replaceAll('_', ' ')}</p>
          <p>{app.nextAction}</p>
          {app.correctionMessage && <div className="banner info">{app.correctionMessage}</div>}
          {app.offerConditions && <p>Offer conditions: {app.offerConditions}</p>}
          {app.offerDeadline && <p>Respond by {when(app.offerDeadline)}</p>}
          <p>Payment reference: {app.paymentReference}</p>
          <div className="card-title"><Icon name="file" /><h3>Uploaded documents</h3></div>
          {app.documents.length === 0 && <p className="muted">No documents uploaded.</p>}
          {app.documents.length > 0 && <div className="table-card"><table><thead><tr><th>Document name</th><th>Type</th><th>Status</th></tr></thead><tbody>{app.documents.map((doc) => <tr key={doc.id}><td>{doc.fileName}</td><td>{doc.requirementCode}</td><td><span className="pill">{doc.state}</span></td></tr>)}</tbody></table></div>}
          <h3>Decisions</h3>
          {app.decisions.length === 0 && <p className="muted">No decision yet.</p>}
          {app.decisions.map((decision) => (
            <p key={decision.id}><strong>{decision.kind} · {decision.outcome}</strong><br />{decision.reason}{decision.internalNote ? <><br />Internal: {decision.internalNote}</> : null}</p>
          ))}
        </div>
        <div className="stack">
          {applicant && (app.state === 'DRAFT' || app.state === 'CORRECTION_REQUESTED') && (
            <form className="card" onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              run(() => api(token).patch(`/admissions/applications/${app.id}`, {
                revision: app.revision,
                dateOfBirth: data.get('dateOfBirth'),
                phone: data.get('phone'),
                address: data.get('address'),
                acknowledgedDeclarationCodes: ['TRUTH'],
              }));
            }}>
              <h3>Your details</h3>
              <label>Date of birth<input name="dateOfBirth" type="date" defaultValue={app.draft.dateOfBirth ?? ''} required /></label>
              <label>Phone<input name="phone" defaultValue={app.draft.phone ?? ''} required /></label>
              <label>Address<textarea name="address" defaultValue={app.draft.address ?? ''} required /></label>
              <button>Save draft</button>
            </form>
          )}
          {applicant && app.state === 'DRAFT' && <button onClick={() => run(() => api(token).post(`/admissions/applications/${app.id}/submit`, {}, { 'Idempotency-Key': crypto.randomUUID() }))}>Submit application</button>}
          {applicant && app.state === 'CORRECTION_REQUESTED' && <button onClick={() => run(() => api(token).post(`/admissions/applications/${app.id}/resubmit`, {}, { 'Idempotency-Key': crypto.randomUUID() }))}>Resubmit</button>}
          {applicant && app.state === 'OFFERED' && (
            <div className="row">
              <button onClick={() => run(() => api(token).post(`/admissions/applications/${app.id}/respond`, { decision: 'ACCEPT' }))}>Accept offer</button>
              <button className="secondary" onClick={() => run(() => api(token).post(`/admissions/applications/${app.id}/respond`, { decision: 'DECLINE' }))}>Decline offer</button>
            </div>
          )}
          {officer && (app.state === 'SUBMITTED' || app.state === 'UNDER_REVIEW') && (
            <button onClick={() => run(() => api(token).post(`/admissions/applications/${app.id}/claim`, { assignmentRevision: app.assignmentRevision }))}>Claim for review</button>
          )}
          {officer && app.state === 'UNDER_REVIEW' && (
            <form className="card" onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              run(() => api(token).post(`/admissions/applications/${app.id}/decisions`, {
                kind: data.get('kind'),
                outcome: data.get('outcome'),
                reason: data.get('reason'),
                offerDeadline: data.get('outcome') === 'OFFERED' ? new Date(Date.now() + 7 * 86400000).toISOString() : undefined,
                conditions: data.get('conditions') || undefined,
                assignmentRevision: app.assignmentRevision,
              }));
            }}>
              <h3>Final decision</h3>
              <label>Kind
                <select name="kind" defaultValue="FINAL"><option value="FINAL">Final decision</option><option value="RECOMMENDATION">Recommendation</option></select>
              </label>
              <label>Outcome
                <select name="outcome" defaultValue="OFFERED"><option value="OFFERED">Offer</option><option value="WAITLISTED">Waitlist</option><option value="REJECTED">Reject</option></select>
              </label>
              <label>Reason<textarea name="reason" required /></label>
              <label>Offer conditions<input name="conditions" /></label>
              <button>Record decision</button>
            </form>
          )}
          {user?.role === 'BURSAR' && (
            <form className="card" onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              run(() => api(token).post('/admissions/payments/events', {
                reference: app.paymentReference,
                providerId: 'manual-reconciliation',
                eventId: crypto.randomUUID(),
                amount: Number(data.get('amount')),
                currency: String(data.get('currency')).toUpperCase(),
                state: 'CONFIRMED',
              }));
            }}>
              <h3>Confirm fee</h3>
              <p className="muted">This records a reconciled payment. It is not a live payment provider.</p>
              <label>Amount<input name="amount" type="number" min="0" step="0.01" required /></label>
              <label>Currency<input name="currency" maxLength={3} required /></label>
              <button>Confirm payment</button>
            </form>
          )}
          {user?.role === 'REGISTRAR' && app.state === 'ACCEPTED' && (
            <button onClick={() => run(() => api(token).post(`/admissions/applications/${app.id}/convert`))}>Convert to student</button>
          )}
        </div>
      </div>
    </Page>
  );
}
