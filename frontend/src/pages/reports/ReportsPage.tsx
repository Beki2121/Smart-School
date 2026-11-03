import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ReportDefinition, ReportFilterOptions, ReportQuery, ReportResult } from '../../api';

type T = (key: string) => string;

const emptyOptions: ReportFilterOptions = { years: [], terms: [], grades: [], sections: [] };

export default function ReportsPage({ t, initialReportId }: { t: T; initialReportId?: string }) {
  const [catalog, setCatalog] = useState<ReportDefinition[]>([]);
  const [options, setOptions] = useState(emptyOptions);
  const [reportId, setReportId] = useState(initialReportId ?? '');
  const [filters, setFilters] = useState<ReportQuery>({ page: 1, pageSize: 50 });
  const [result, setResult] = useState<ReportResult | null>(null);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [loadingReport, setLoadingReport] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  const loadCatalog = useCallback(async () => {
    setLoadingCatalog(true);
    setError('');
    try {
      const [reports, filterOptions] = await Promise.all([
        api.reportsCatalog(), api.reportFilters()
      ]);
      setCatalog(reports);
      setOptions(filterOptions);
      setReportId((current) => current && reports.some((report) => report.id === current)
        ? current
        : reports.some((report) => report.id === initialReportId)
          ? initialReportId ?? ''
          : reports[0]?.id ?? '');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t('reportLoadFailed'));
    } finally {
      setLoadingCatalog(false);
    }
  }, [initialReportId, t]);

  useEffect(() => { void loadCatalog(); }, [loadCatalog]);

  const loadReport = useCallback(async () => {
    if (!reportId) return;
    setLoadingReport(true);
    setError('');
    try {
      setResult(await api.report(reportId, filters));
    } catch (loadError) {
      setResult(null);
      setError(loadError instanceof Error ? loadError.message : t('reportLoadFailed'));
    } finally {
      setLoadingReport(false);
    }
  }, [filters, reportId, t]);

  useEffect(() => { void loadReport(); }, [loadReport]);

  const selected = catalog.find((report) => report.id === reportId);
  const visibleTerms = useMemo(() => options.terms.filter((term) =>
    !filters.year || term.yearId === filters.year), [filters.year, options.terms]);
  const visibleSections = useMemo(() => options.sections.filter((section) =>
    (!filters.year || section.yearId === filters.year) &&
    (!filters.grade || section.gradeId === filters.grade)),
  [filters.grade, filters.year, options.sections]);
  const summary = result ? Object.entries(result.summary).filter(([, value]) =>
    typeof value === 'string' || typeof value === 'number') : [];

  const updateFilter = (key: keyof ReportQuery, value: string) => {
    setFilters((current) => ({
      ...current, [key]: value || undefined, page: 1
    }));
  };

  const downloadCsv = async () => {
    if (!reportId) return;
    setExporting(true);
    setError('');
    try {
      const blob = await api.exportReport(reportId, filters);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${reportId}.csv`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : t('reportExportFailed'));
    } finally {
      setExporting(false);
    }
  };

  if (loadingCatalog) return <div className="loading-state">{t('loading')}</div>;
  if (!catalog.length) return <div className="empty-state">{t('noReportsAvailable')}</div>;

  return (
    <div className="reports-page">
      <div className="page-heading">
        <div><div className="eyebrow">{t('overview')}</div>
          <h1>{t('reportsCenter')}</h1><p>{t('reportsCenterHint')}</p></div>
      </div>
      <section className="panel reports-panel">
        <div className="reports-controls">
          <label>{t('selectReport')}
            <select value={reportId} onChange={(event) => {
              setReportId(event.target.value);
              setFilters((current) => ({ ...current, page: 1 }));
            }}>
              {catalog.map((report) => <option key={report.id} value={report.id}>
                {t(`report_${report.id}`)}
              </option>)}
            </select>
          </label>
          <label>{t('academicYear')}
            <select value={filters.year ?? ''} onChange={(event) => {
              updateFilter('year', event.target.value);
              updateFilter('term', '');
            }}>
              <option value="">{t('allYears')}</option>
              {options.years.map((year) => <option key={year.id} value={year.id}>{year.label}</option>)}
            </select>
          </label>
          <label>{t('term')}
            <select value={filters.term ?? ''} onChange={(event) => updateFilter('term', event.target.value)}>
              <option value="">{t('allTerms')}</option>
              {visibleTerms.map((term) => <option key={term.id} value={term.id}>{term.label}</option>)}
            </select>
          </label>
          <label>{t('grade')}
            <select value={filters.grade ?? ''} onChange={(event) => {
              updateFilter('grade', event.target.value);
              updateFilter('section', '');
            }}>
              <option value="">{t('allGrades')}</option>
              {options.grades.map((grade) => <option key={grade.id} value={grade.id}>{grade.label}</option>)}
            </select>
          </label>
          <label>{t('section')}
            <select value={filters.section ?? ''} onChange={(event) => updateFilter('section', event.target.value)}>
              <option value="">{t('allSections')}</option>
              {visibleSections.map((section) =>
                <option key={section.id} value={section.id}>{section.label}</option>)}
            </select>
          </label>
          <label>{t('dateFrom')}
            <input type="date" value={filters.from ?? ''}
              onChange={(event) => updateFilter('from', event.target.value)} />
          </label>
          <label>{t('dateTo')}
            <input type="date" value={filters.to ?? ''}
              onChange={(event) => updateFilter('to', event.target.value)} />
          </label>
          {selected?.id === 'teacher-workload' && <label>{t('workloadLimit')}
            <input type="number" min="1" max="100"
              value={filters.workloadLimit ?? 25}
              onChange={(event) => setFilters((current) => ({
                ...current,
                workloadLimit: event.target.value ? Number(event.target.value) : undefined,
                page: 1
              }))} />
          </label>}
        </div>
        <div className="report-actions">
          <span>{selected ? t(`report_${selected.id}`) : ''}</span>
          <div>
            <button type="button" className="button button-secondary" disabled={!selected?.csvExport || exporting}
              onClick={() => void downloadCsv()}>{exporting ? t('loading') : t('exportCsv')}</button>
            <button type="button" className="button button-secondary print-button" disabled={!selected?.printView}
              onClick={() => window.print()}>{t('printReport')}</button>
          </div>
        </div>
        {error && <div className="form-error" role="alert">{error}
          <button type="button" className="button button-quiet" onClick={() => {
            if (result) void downloadCsv(); else void loadReport();
          }}>{t('retry')}</button>
        </div>}
        {summary.length > 0 && <div className="metric-grid report-summary">
          {summary.map(([key, value]) => <article className="metric-card" key={key}>
            <div className="metric-content"><span>{t(`reportSummary_${key}`)}</span><strong>{String(value)}</strong></div>
          </article>)}
        </div>}
        {loadingReport ? <div className="loading-state">{t('loading')}</div> : result ? (
          <>
            <div className="table-wrap reports-table-wrap">
              <table className="data-table">
                <thead><tr>{result.columns.map((column) =>
                  <th key={column}>{t(`reportColumn_${column}`)}</th>)}</tr></thead>
                <tbody>
                  {result.rows.map((row, index) => <tr key={`${result.report}-${index}`}>
                    {result.columns.map((column) => <td key={column}>
                      {column === 'warning' && typeof row[column] === 'boolean'
                        ? t(row[column] ? 'workloadOverLimit' : 'workloadWithinLimit')
                        : row[column] == null ? '—' : String(row[column])}
                    </td>)}
                  </tr>)}
                  {!result.rows.length && <tr><td colSpan={result.columns.length}>
                    {t('noReportRows')}
                  </td></tr>}
                </tbody>
              </table>
            </div>
            <div className="reports-pagination">
              <span>{t('reportRecordCount')}: {result.total}</span>
              <div>
                <button type="button" className="button button-quiet" disabled={result.page <= 1 || loadingReport}
                  onClick={() => setFilters((current) => ({ ...current, page: Math.max(1, (current.page ?? 1) - 1) }))}>
                  {t('previous')}
                </button>
                <span>{result.page}</span>
                <button type="button" className="button button-quiet" disabled={!result.hasMore || loadingReport}
                  onClick={() => setFilters((current) => ({ ...current, page: (current.page ?? 1) + 1 }))}>
                  {t('next')}
                </button>
              </div>
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}
