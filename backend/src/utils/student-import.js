import { studentSchema } from '../schemas/students.schema.js';

function studentCsvError(message) {
  const error = new Error(message);
  error.status = 400;
  error.code = 'VALIDATION_ERROR';
  return error;
}

function parseStudentCsv(csv) {
  if (typeof csv !== 'string' || !csv.trim()) throw studentCsvError('Upload a non-empty CSV file.');
  const records = [];
  let record = [];
  let field = '';
  let quoted = false;
  let quoteClosed = false;
  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    if (quoted) {
      if (character === '"' && csv[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
        quoteClosed = true;
      } else {
        field += character;
      }
      continue;
    }
    if (quoteClosed && character !== ',' && character !== '\r' && character !== '\n' && !/\s/.test(character)) {
      throw studentCsvError('CSV contains unexpected text after a quoted field.');
    }
    if (character === ',' || character === '\r' || character === '\n') {
      record.push(field.trim());
      field = '';
      quoteClosed = false;
      if (character !== ',') {
        if (character === '\r' && csv[index + 1] === '\n') index += 1;
        if (record.some((value) => value !== '')) records.push(record);
        record = [];
      }
    } else if (character === '"' && field === '') {
      quoted = true;
    } else if (character === '"') {
      throw studentCsvError('CSV contains a quote inside an unquoted field; escape quotes by doubling them.');
    } else {
      field += character;
    }
  }
  if (quoted) throw studentCsvError('CSV contains an unclosed quoted field.');
  record.push(field.trim());
  if (record.some((value) => value !== '')) records.push(record);
  if (records.length < 2) throw studentCsvError('CSV must contain a header and at least one student row.');

  const headers = records[0].map((header, index) =>
    (index === 0 ? header.replace(/^\uFEFF/, '') : header).trim());
  const allowedHeaders = new Set([
    'studentNo', 'givenNameAm', 'fatherNameAm', 'grandfatherNameAm',
    'givenNameEn', 'fatherNameEn', 'grandfatherNameEn', 'gender',
    'dateOfBirth', 'guardianPhone', 'previousSchool', 'sectionName'
  ]);
  const requiredHeaders = [
    'studentNo', 'givenNameAm', 'fatherNameAm', 'grandfatherNameAm',
    'givenNameEn', 'fatherNameEn', 'grandfatherNameEn', 'gender', 'sectionName'
  ];
  if (headers.some((header) => !header || !allowedHeaders.has(header))) {
    throw studentCsvError('CSV has an empty or unsupported column. Use the provided student import template.');
  }
  if (new Set(headers).size !== headers.length) throw studentCsvError('CSV contains duplicate column names.');
  const missingHeaders = requiredHeaders.filter((header) => !headers.includes(header));
  if (missingHeaders.length) throw studentCsvError(`CSV is missing required columns: ${missingHeaders.join(', ')}.`);
  const dataRows = [];
  const rowReports = [];
  const rawRows = records.slice(1);
  if (rawRows.length > 600) throw studentCsvError('A student import can contain at most 600 rows.');
  for (const [index, values] of rawRows.entries()) {
    const rowNumber = index + 2;
    if (values.length !== headers.length) {
      rowReports.push({
        rowNumber, eligible: false, errors: [{
          field: '', message: `Expected ${headers.length} columns but found ${values.length}.`
        }], warnings: []
      });
      continue;
    }
    const input = Object.fromEntries(headers.map((header, column) => [header, values[column]]));
    for (const optional of ['dateOfBirth', 'guardianPhone', 'previousSchool']) {
      if (!input[optional]) input[optional] = null;
    }
    const result = studentSchema.safeParse(input);
    if (!result.success) {
      rowReports.push({
        rowNumber, eligible: false,
        errors: result.error.issues.map((issue) => ({
          field: issue.path.join('.'), message: issue.message
        })),
        warnings: []
      });
      continue;
    }
    dataRows.push({ rowNumber, data: result.data });
  }
  return { dataRows, rowReports, totalRows: rawRows.length };
}

export async function previewStudentCsv(repo, csv, actor) {
  const parsed = parseStudentCsv(csv);
  const businessReports = await repo.previewStudentImport(parsed.dataRows, actor);
  const reportsByRow = new Map([...parsed.rowReports, ...businessReports].map((report) =>
    [report.rowNumber, report]));
  const rows = [...reportsByRow.values()].sort((left, right) => left.rowNumber - right.rowNumber);
  return {
    ...parsed, rows,
    eligibleCount: rows.filter((row) => row.eligible).length,
    invalidCount: rows.filter((row) => !row.eligible).length,
    warningCount: rows.filter((row) => row.warnings.length > 0).length
  };
}
