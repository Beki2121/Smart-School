import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, LibraryBook, LibraryCategory, LibraryCopy, LibraryFine, LibraryLoan,
  LibraryMember, LibraryReservation, LibrarySettings, PortalLibrary } from '../../api';

type T = (key: string) => string;
type Props = { t: T; permissions: string[] };
const today = () => new Date().toISOString().slice(0, 10);
const key = () => crypto.randomUUID();

export default function LibraryPage({ t, permissions }: Props) {
  const can = (permission: string) => permissions.includes(permission);
  const librarian = can('library.catalog.view');
  const [dashboard, setDashboard] = useState({ total: 0, available: 0, borrowed: 0, overdue: 0 });
  const [categories, setCategories] = useState<LibraryCategory[]>([]);
  const [books, setBooks] = useState<LibraryBook[]>([]);
  const [copies, setCopies] = useState<LibraryCopy[]>([]);
  const [members, setMembers] = useState<LibraryMember[]>([]);
  const [loans, setLoans] = useState<LibraryLoan[]>([]);
  const [reservations, setReservations] = useState<LibraryReservation[]>([]);
  const [fines, setFines] = useState<LibraryFine[]>([]);
  const [settings, setSettings] = useState<LibrarySettings>({
    loanPeriodDays: 14, maxActiveLoans: 5, maxRenewals: 2, fineMinorPerDay: 100, currencyCode: 'ETB'
  });
  const [portal, setPortal] = useState<PortalLibrary | null>(null);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [bookStatusFilter, setBookStatusFilter] = useState('active');
  const [copyStatusFilter, setCopyStatusFilter] = useState('');
  const [loanFilter, setLoanFilter] = useState('');
  const [barcode, setBarcode] = useState('');
  const [categoryName, setCategoryName] = useState('');
  const [bookDraft, setBookDraft] = useState({
    categoryId: '', title: '', author: '', isbn: '', publisher: '', description: ''
  });
  const [editingBook, setEditingBook] = useState<string | null>(null);
  const [editingCopy, setEditingCopy] = useState<string | null>(null);
  const [copyEditDraft, setCopyEditDraft] = useState({
    barcode: '', copyNumber: '', condition: 'good', shelfLocation: ''
  });
  const [copyDraft, setCopyDraft] = useState({
    bookId: '', copyNumber: '', barcode: '', condition: 'good', shelfLocation: ''
  });
  const [memberDraft, setMemberDraft] = useState({ memberType: 'student' as 'student' | 'staff', personId: '' });
  const [issueDraft, setIssueDraft] = useState({ copyId: '', memberId: '', issuedOn: today() });
  const [reservationDraft, setReservationDraft] = useState({ bookId: '', memberId: '' });
  const [fineReason, setFineReason] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!librarian) {
      setPortal(await api.portalLibrary());
      return;
    }
    const jobs: Promise<void>[] = [
      api.libraryDashboard().then(setDashboard),
      api.libraryCategories().then(setCategories),
      api.libraryBooks({ search, categoryId: categoryFilter || undefined,
        status: bookStatusFilter || undefined }).then(setBooks),
      api.librarySettings().then(setSettings)
    ];
    if (can('library.circulation.manage')) jobs.push(
      api.libraryCopies({ search, categoryId: categoryFilter || undefined,
        status: copyStatusFilter || undefined }).then(setCopies),
      api.libraryMembers().then(setMembers),
      api.libraryLoans().then(setLoans),
      api.libraryReservations().then(setReservations)
    );
    if (can('library.fines.view')) jobs.push(api.libraryFines().then(setFines));
    await Promise.all(jobs);
  }, [librarian, permissions, search, categoryFilter, bookStatusFilter, copyStatusFilter]);

  useEffect(() => {
    load().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : t('apiError')));
  }, [load, t]);

  async function perform(action: () => Promise<unknown>) {
    setBusy(true); setError(''); setNotice('');
    try { await action(); await load(); setNotice(t('librarySaved')); }
    catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  }
  async function saveBook(event: FormEvent) {
    event.preventDefault();
    const body = { ...bookDraft, categoryId: bookDraft.categoryId || null, isbn: bookDraft.isbn || null };
    await perform(async () => {
      if (editingBook) await api.updateLibraryBook(editingBook, body);
      else await api.createLibraryBook(body);
      setEditingBook(null);
      setBookDraft({ categoryId: '', title: '', author: '', isbn: '', publisher: '', description: '' });
    });
  }
  async function saveCopy(event: FormEvent) {
    event.preventDefault();
    if (!editingCopy) return;
    await perform(async () => {
      await api.updateLibraryCopy(editingCopy, copyEditDraft);
      setEditingCopy(null);
    });
  }
  async function lookupBarcode(event: FormEvent) {
    event.preventDefault();
    setError('');
    try {
      const copy = await api.libraryCopyByBarcode(barcode);
      setCopies([copy]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
  }
  async function downloadReport(id: string) {
    try {
      const blob = await api.exportReport(id);
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob); link.download = `${id}.csv`; link.click();
      URL.revokeObjectURL(link.href);
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
  }

  if (!librarian) return <section className="page-section">
    <header className="section-heading"><div><h1>{t('navLibrary')}</h1>
      <p>{t('libraryPortalHint')}</p></div></header>
    {error && <div className="notice notice-error" role="alert">{error}</div>}
    {!portal && !error && <div className="loading-state">{t('loading')}</div>}
    {portal && <div className="record-list">
      <section className="panel"><h2>{t('libraryLoans')}</h2>
        {portal.loans.length ? portal.loans.map((loan) => <p key={loan.id}>
          {loan.book?.title} · {loan.status} · {t('libraryDue')}: {loan.dueOn}</p>)
          : <p>{t('libraryNoLoans')}</p>}
      </section>
      <section className="panel"><h2>{t('libraryReservations')}</h2>
        {portal.reservations.length ? portal.reservations.map((item) => <p key={item.id}>
          {item.book?.title} · {item.status}{item.readyUntil ? ` · ${item.readyUntil}` : ''}</p>)
          : <p>{t('libraryNoReservations')}</p>}
      </section>
      <section className="panel"><h2>{t('libraryFines')}</h2>
        {portal.fines.length ? portal.fines.map((fine) => <p key={fine.id}>
          {fine.amountMinor} {fine.currencyCode} · {fine.status}</p>) : <p>{t('libraryNoFines')}</p>}
      </section>
    </div>}
  </section>;

  return <section className="page-section library-page">
    <style>{'@media print { .library-page button, .library-page form, .library-page .toolbar { display:none !important; } .library-page .panel { border:0; box-shadow:none; break-inside:avoid; } }'}</style>
    <header className="section-heading"><div><span className="eyebrow">{t('navSchoolServices')}</span>
      <h1>{t('navLibrary')}</h1><p>{t('libraryHint')}</p></div>
      <button className="button button-quiet" type="button" onClick={() => window.print()}>{t('print')}</button>
    </header>
    {error && <div className="notice notice-error" role="alert">{error}</div>}
    {notice && <div className="notice" role="status">{notice}</div>}
    <div className="metric-grid">
      {(['total', 'available', 'borrowed', 'overdue'] as const).map((metric) =>
        <article className="metric-card" key={metric}><span>{t(`library_${metric}`)}</span>
          <strong>{dashboard[metric]}</strong></article>)}
    </div>
    <section className="panel">
      <div className="panel-heading"><div><h2>{t('libraryCatalogue')}</h2></div>
        <label>{t('search')}<input value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <label>{t('libraryCategory')}<select value={categoryFilter}
          onChange={(event) => setCategoryFilter(event.target.value)}>
          <option value="">{t('all')}</option>{categories.map((item) =>
            <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>{t('status')}<select value={bookStatusFilter}
          onChange={(event) => setBookStatusFilter(event.target.value)}>
          <option value="">{t('all')}</option><option value="active">{t('active')}</option>
          <option value="archived">{t('archived')}</option></select></label>
      </div>
      <div className="library-print-area">
        <div className="toolbar">
          <button className="button button-quiet" type="button" onClick={() => void downloadReport('library-inventory')}>{t('exportCsv')}</button>
          <button className="button button-quiet" type="button" onClick={() => void downloadReport('library-circulation')}>{t('libraryCirculationReport')}</button>
        </div>
        <div className="record-list">{books.map((book) => <article className="communication-item" key={book.id}>
          <div><h3>{book.title}</h3><p>{book.author} · {book.isbn ?? '—'} · {categories.find((item) => item.id === book.categoryId)?.name ?? ''}</p>
            <small>{book.copies?.length ?? 0} {t('libraryCopies')} · {book.status}</small>
            {book.description && <details><summary>{t('view')}</summary><p>{book.description}</p></details>}</div>
          {can('library.catalog.manage') && <div className="toolbar">
            <button type="button" className="button button-quiet" onClick={() => {
              setEditingBook(book.id); setBookDraft({ categoryId: book.categoryId ?? '',
                title: book.title, author: book.author, isbn: book.isbn ?? '',
                publisher: book.publisher, description: book.description });
            }}>{t('edit')}</button>
            {book.status !== 'archived' && <button type="button" className="button button-quiet"
              onClick={() => void perform(() => api.archiveLibraryBook(book.id))}>{t('archive')}</button>}
          </div>}
        </article>)}</div>
      </div>
    </section>
    {can('library.catalog.manage') && <div className="record-list">
      <section className="panel">
        <h2>{t('libraryCategories')}</h2>
        <form className="form-grid" onSubmit={(event) => {
          event.preventDefault(); void perform(async () => {
            await api.createLibraryCategory({ name: categoryName }); setCategoryName('');
          });
        }}>
          <label>{t('libraryCategory')}<input required value={categoryName}
            onChange={(event) => setCategoryName(event.target.value)} /></label>
          <button disabled={busy} className="button button-primary">{t('add')}</button>
        </form>
        {categories.map((category) => <p key={category.id}>{category.name}
          <button type="button" className="button button-quiet" onClick={() => {
            const name = window.prompt(t('libraryCategory'), category.name);
            if (name?.trim()) void perform(() => api.updateLibraryCategory(category.id, { name }));
          }}>{t('edit')}</button></p>)}
      </section>
      <section className="panel">
        <h2>{editingBook ? t('edit') : t('libraryAddBook')}</h2>
        <form className="form-grid" onSubmit={(event) => void saveBook(event)}>
          <label>{t('libraryTitle')}<input required value={bookDraft.title}
            onChange={(event) => setBookDraft({ ...bookDraft, title: event.target.value })} /></label>
          <label>{t('libraryAuthor')}<input required value={bookDraft.author}
            onChange={(event) => setBookDraft({ ...bookDraft, author: event.target.value })} /></label>
          <label>ISBN<input value={bookDraft.isbn} onChange={(event) => setBookDraft({ ...bookDraft, isbn: event.target.value })} /></label>
          <label>{t('libraryCategory')}<select value={bookDraft.categoryId}
            onChange={(event) => setBookDraft({ ...bookDraft, categoryId: event.target.value })}>
            <option value="">{t('none')}</option>{categories.map((item) =>
              <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>{t('libraryPublisher')}<input value={bookDraft.publisher}
            onChange={(event) => setBookDraft({ ...bookDraft, publisher: event.target.value })} /></label>
          <label>{t('description')}<textarea value={bookDraft.description}
            onChange={(event) => setBookDraft({ ...bookDraft, description: event.target.value })} /></label>
          <button disabled={busy} className="button button-primary">{editingBook ? t('save') : t('add')}</button>
          {editingBook && <button type="button" className="button button-quiet" onClick={() => setEditingBook(null)}>{t('cancel')}</button>}
        </form>
      </section>
      <section className="panel">
        <h2>{t('libraryAddCopy')}</h2>
        <form className="form-grid" onSubmit={(event) => {
          event.preventDefault(); void perform(async () => {
            await api.createLibraryCopy({ ...copyDraft, bookId: copyDraft.bookId });
            setCopyDraft({ bookId: '', copyNumber: '', barcode: '', condition: 'good', shelfLocation: '' });
          });
        }}>
          <label>{t('libraryBook')}<select required value={copyDraft.bookId}
            onChange={(event) => setCopyDraft({ ...copyDraft, bookId: event.target.value })}>
            <option value="">{t('select')}</option>{books.filter((book) => book.status === 'active').map((book) =>
              <option key={book.id} value={book.id}>{book.title}</option>)}</select></label>
          <label>{t('libraryCopyNumber')}<input required value={copyDraft.copyNumber}
            onChange={(event) => setCopyDraft({ ...copyDraft, copyNumber: event.target.value })} /></label>
          <label>{t('libraryBarcode')}<input required value={copyDraft.barcode}
            onChange={(event) => setCopyDraft({ ...copyDraft, barcode: event.target.value })} /></label>
          <label>{t('libraryShelf')}<input value={copyDraft.shelfLocation}
            onChange={(event) => setCopyDraft({ ...copyDraft, shelfLocation: event.target.value })} /></label>
          <button disabled={busy} className="button button-primary">{t('add')}</button>
        </form>
      </section>
    </div>}
    {can('library.circulation.manage') && <section className="panel">
      <h2>{t('libraryCopies')}</h2>
      <div className="toolbar">
        <label>{t('status')}<select value={copyStatusFilter}
          onChange={(event) => setCopyStatusFilter(event.target.value)}>
          <option value="">{t('all')}</option>
          {['available', 'loaned', 'reserved', 'damaged', 'lost', 'archived'].map((status) =>
            <option key={status} value={status}>{t(status)}</option>)}
        </select></label>
        {can('library.reports.view') && <button className="button button-quiet" type="button"
          onClick={() => void downloadReport('library-copies')}>{t('libraryCopiesCsv')}</button>}
      </div>
      <form className="form-grid" onSubmit={(event) => void lookupBarcode(event)}>
        <label>{t('libraryBarcode')}<input value={barcode} onChange={(event) => setBarcode(event.target.value)} /></label>
        <button className="button button-quiet">{t('libraryBarcodeLookup')}</button>
      </form>
      {copies.map((copy) => <article className="communication-item" key={copy.id}>
        {editingCopy === copy.id
          ? <form className="form-grid" onSubmit={(event) => void saveCopy(event)}>
            <label>{t('libraryBarcode')}<input required value={copyEditDraft.barcode}
              onChange={(event) => setCopyEditDraft({ ...copyEditDraft, barcode: event.target.value })} /></label>
            <label>{t('libraryCopyNumber')}<input required value={copyEditDraft.copyNumber}
              onChange={(event) => setCopyEditDraft({ ...copyEditDraft, copyNumber: event.target.value })} /></label>
            <label>{t('libraryCondition')}<select value={copyEditDraft.condition}
              onChange={(event) => setCopyEditDraft({ ...copyEditDraft, condition: event.target.value })}>
              {['new', 'good', 'worn', 'damaged', 'lost'].map((condition) =>
                <option key={condition} value={condition}>{t(condition)}</option>)}
            </select></label>
            <label>{t('libraryShelf')}<input value={copyEditDraft.shelfLocation}
              onChange={(event) => setCopyEditDraft({ ...copyEditDraft, shelfLocation: event.target.value })} /></label>
            <button disabled={busy} className="button button-primary">{t('save')}</button>
            <button type="button" className="button button-quiet" onClick={() => setEditingCopy(null)}>{t('cancel')}</button>
          </form>
          : <div><strong>{copy.book?.title}</strong><small>{copy.barcode} · {copy.copyNumber} · {copy.condition} · {copy.shelfLocation} · {copy.status}</small></div>}
        {can('library.catalog.manage') && <div className="toolbar">
          {editingCopy !== copy.id && <button type="button" className="button button-quiet" onClick={() => {
            setEditingCopy(copy.id);
            setCopyEditDraft({ barcode: copy.barcode, copyNumber: copy.copyNumber,
              condition: copy.condition, shelfLocation: copy.shelfLocation });
          }}>{t('edit')}</button>}
          {copy.status !== 'loaned' && copy.status !== 'reserved' &&
            <button type="button" className="button button-quiet"
              onClick={() => void perform(() => api.archiveLibraryCopy(copy.id))}>{t('archive')}</button>}
        </div>}
      </article>)}
    </section>}
    {can('library.members.manage') && <section className="panel">
      <h2>{t('libraryMembers')}</h2>
      <form className="form-grid" onSubmit={(event) => {
        event.preventDefault(); void perform(async () => {
          await api.addLibraryMember(memberDraft.memberType === 'student'
            ? { memberType: 'student', studentId: memberDraft.personId }
            : { memberType: 'staff', staffId: memberDraft.personId });
          setMemberDraft({ ...memberDraft, personId: '' });
        });
      }}>
        <label>{t('libraryMemberType')}<select value={memberDraft.memberType}
          onChange={(event) => setMemberDraft({ ...memberDraft, memberType: event.target.value as 'student' | 'staff' })}>
          <option value="student">{t('student')}</option><option value="staff">{t('staff')}</option></select></label>
        <label>{t('libraryPersonId')}<input required value={memberDraft.personId}
          onChange={(event) => setMemberDraft({ ...memberDraft, personId: event.target.value })} /></label>
        <button disabled={busy} className="button button-primary">{t('add')}</button>
      </form>
      {members.map((member) => <p key={member.id}>{member.name} · {member.memberType} · {member.status}</p>)}
    </section>}
    {can('library.circulation.manage') && <section className="panel">
      <h2>{t('libraryCirculation')}</h2>
      <label>{t('status')}<select value={loanFilter}
        onChange={(event) => setLoanFilter(event.target.value)}>
        <option value="">{t('all')}</option><option value="overdue">{t('libraryOverdueList')}</option>
        <option value="active">{t('active')}</option><option value="returned">{t('returned')}</option>
      </select></label>
      <form className="form-grid" onSubmit={(event) => {
        event.preventDefault(); void perform(async () => {
          await api.issueLibraryCopy({ ...issueDraft, idempotencyKey: key() });
          setIssueDraft({ ...issueDraft, copyId: '', memberId: '' });
        });
      }}>
        <label>{t('libraryCopyId')}<input required value={issueDraft.copyId}
          onChange={(event) => setIssueDraft({ ...issueDraft, copyId: event.target.value })} /></label>
        <label>{t('libraryMember')}<select required value={issueDraft.memberId}
          onChange={(event) => setIssueDraft({ ...issueDraft, memberId: event.target.value })}>
          <option value="">{t('select')}</option>{members.map((item) =>
            <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>{t('libraryIssuedOn')}<input type="date" required value={issueDraft.issuedOn}
          onChange={(event) => setIssueDraft({ ...issueDraft, issuedOn: event.target.value })} /></label>
        <button disabled={busy} className="button button-primary">{t('libraryIssue')}</button>
      </form>
      {loans.filter((loan) => loanFilter === 'overdue'
        ? loan.status === 'active' && loan.dueOn < today()
        : !loanFilter || loan.status === loanFilter).map((loan) => <article className="communication-item" key={loan.id}>
        <div><strong>{loan.book?.title}</strong><small>{loan.member?.name} · {loan.copy?.barcode} · {loan.status} · {t('libraryDue')}: {loan.dueOn}</small></div>
        {loan.status === 'active' && <div className="toolbar">
          <button type="button" className="button button-quiet" onClick={() =>
            void perform(() => api.renewLibraryLoan(loan.id))}>{t('libraryRenew')}</button>
          <button type="button" className="button button-primary" onClick={() =>
            void perform(() => api.returnLibraryLoan(loan.id, { returnedOn: today(), returnCondition: 'good' }))}>{t('libraryReturn')}</button>
        </div>}
        {loan.fine && <small>{t('libraryFine')}: {loan.fine.amountMinor} {loan.fine.currencyCode}</small>}
      </article>)}
    </section>}
    {can('library.circulation.manage') && <section className="panel">
      <h2>{t('libraryReservations')}</h2>
      <form className="form-grid" onSubmit={(event) => {
        event.preventDefault(); void perform(() => api.reserveLibraryBook({
          ...reservationDraft, idempotencyKey: key()
        }));
      }}>
        <label>{t('libraryBook')}<select required value={reservationDraft.bookId}
          onChange={(event) => setReservationDraft({ ...reservationDraft, bookId: event.target.value })}>
          <option value="">{t('select')}</option>{books.map((item) =>
            <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
        <label>{t('libraryMember')}<select required value={reservationDraft.memberId}
          onChange={(event) => setReservationDraft({ ...reservationDraft, memberId: event.target.value })}>
          <option value="">{t('select')}</option>{members.map((item) =>
            <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <button disabled={busy} className="button button-primary">{t('libraryReserve')}</button>
      </form>
      {reservations.map((item) => <p key={item.id}>{item.bookId} · {item.memberId} · #{item.queuePosition} · {item.status}
        {['queued', 'ready'].includes(item.status) && <button className="button button-quiet" type="button"
          onClick={() => void perform(() => api.cancelLibraryReservation(item.id))}>{t('cancel')}</button>}</p>)}
    </section>}
    {can('library.fines.view') && <section className="panel">
      <h2>{t('libraryFines')}</h2>
      {fines.map((fine) => <article className="communication-item" key={fine.id}>
        <div><strong>{fine.member?.name}</strong><small>{fine.amountMinor} {fine.currencyCode} · {fine.overdueDays} {t('libraryOverdueDays')} · {fine.status}</small></div>
        {fine.status === 'unpaid' && <div className="toolbar">
          {can('library.fines.manage') && <button className="button button-quiet" type="button"
            onClick={() => void perform(() => api.payLibraryFine(fine.id, today()))}>{t('libraryMarkPaid')}</button>}
          {can('library.fines.waive') && <><input aria-label={t('reason')}
            value={fineReason[fine.id] ?? ''} onChange={(event) => setFineReason({
              ...fineReason, [fine.id]: event.target.value
            })} /><button className="button button-quiet" type="button" disabled={!fineReason[fine.id]}
              onClick={() => void perform(() => api.waiveLibraryFine(fine.id, fineReason[fine.id]))}>{t('libraryWaive')}</button></>}
        </div>}
      </article>)}
    </section>}
    {can('library.catalog.manage') && <section className="panel">
      <h2>{t('librarySettings')}</h2>
      <form className="form-grid" onSubmit={(event) => {
        event.preventDefault(); void perform(() => api.updateLibrarySettings(settings));
      }}>
        <label>{t('libraryLoanDays')}<input type="number" min="1" max="365" value={settings.loanPeriodDays}
          onChange={(event) => setSettings({ ...settings, loanPeriodDays: Number(event.target.value) })} /></label>
        <label>{t('libraryMaxLoans')}<input type="number" min="1" value={settings.maxActiveLoans}
          onChange={(event) => setSettings({ ...settings, maxActiveLoans: Number(event.target.value) })} /></label>
        <label>{t('libraryMaxRenewals')}<input type="number" min="0" value={settings.maxRenewals}
          onChange={(event) => setSettings({ ...settings, maxRenewals: Number(event.target.value) })} /></label>
        <label>{t('libraryFinePerDay')} ({t('minorUnits')})<input type="number" min="0"
          value={settings.fineMinorPerDay} onChange={(event) =>
            setSettings({ ...settings, fineMinorPerDay: Number(event.target.value) })} /></label>
        <label>{t('currency')}<input maxLength={3} value={settings.currencyCode}
          onChange={(event) => setSettings({ ...settings, currencyCode: event.target.value.toUpperCase() })} /></label>
        <button disabled={busy} className="button button-primary">{t('save')}</button>
      </form>
    </section>}
  </section>;
}
