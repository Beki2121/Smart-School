import { hrStaffImportSchema } from '../schemas/hr.schema.js';

function csvError(message) {
  const error = new Error(message);
  error.status = 400;
  error.code = 'VALIDATION_ERROR';
  return error;
}

function parseRecords(csv) {
  if (typeof csv !== 'string' || !csv.trim()) throw csvError('Upload a non-empty CSV file.');
  const records = [];
  let record = [];
  let field = '';
  let quoted = false;
  let closed = false;
  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    if (quoted) {
      if (character === '"' && csv[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
        closed = true;
      } else field += character;
      continue;
    }
    if (closed && character !== ',' && character !== '\r' && character !== '\n' &&
        !/\s/.test(character)) throw csvError('CSV has unexpected text after a quoted field.');
    if (character === ',' || character === '\r' || character === '\n') {
      record.push(field.trim());
      field = '';
      closed = false;
      if (character !== ',') {
        if (character === '\r' && csv[index + 1] === '\n') index += 1;
        if (record.some((value) => value !== '')) records.push(record);
        record = [];
      }
    } else if (character === '"' && !field) quoted = true;
    else if (character === '"') throw csvError('CSV quote in an unquoted field; escape quotes by doubling them.');
    else field += character;
  }
  if (quoted) throw csvError('CSV contains an unclosed quoted field.');
  record.push(field.trim());
  if (record.some((value) => value !== '')) records.push(record);
  if (records.length < 2) throw csvError('CSV must contain a header and at least one staff row.');
  return records;
}

export async function previewHrStaffCsv(repo, csv, actor) {
  const records = parseRecords(csv);
  const headers = records[0].map((header, index) =>
    (index === 0 ? header.replace(/^\uFEFF/, '') : header).trim());
  const allowed = new Set([
    'departmentId', 'givenNameEn', 'fatherNameEn', 'grandfatherNameEn',
    'givenNameAm', 'fatherNameAm', 'grandfatherNameAm', 'jobTitle',
    'qualification', 'employmentStatus', 'hiredOn'
  ]);
  const required = [
    'givenNameEn', 'fatherNameEn', 'grandfatherNameEn', 'givenNameAm',
    'fatherNameAm', 'grandfatherNameAm', 'jobTitle'
  ];
  if (headers.some((header) => !header || !allowed.has(header))) {
    throw csvError('CSV contains an unsupported or empty column.');
  }
  if (new Set(headers).size !== headers.length) throw csvError('CSV contains duplicate column names.');
  const missing = required.filter((header) => !headers.includes(header));
  if (missing.length) throw csvError(`CSV is missing required columns: ${missing.join(', ')}.`);
  const dataRows = [];
  const invalid = [];
  const rawRows = records.slice(1);
  if (rawRows.length > 600) throw csvError('A staff import can contain at most 600 rows.');
  for (const [index, values] of rawRows.entries()) {
    const rowNumber = index + 2;
    if (values.length !== headers.length) {
      invalid.push({ rowNumber, eligible: false, warnings: [], errors: [{
        field: '', message: `Expected ${headers.length} columns but found ${values.length}.`
      }] });
      continue;
    }
    const input = Object.fromEntries(headers.map((header, column) => [header, values[column] || null]));
    const parsed = hrStaffImportSchema.safeParse(input);
    if (!parsed.success) {
      invalid.push({ rowNumber, eligible: false, warnings: [], errors: parsed.error.issues.map((issue) => ({
        field: issue.path.join('.'), message: issue.message
      })) });
      continue;
    }
    dataRows.push({ rowNumber, data: parsed.data });
  }
  const business = await repo.previewHrStaffImport(dataRows, actor);
  const rows = [...invalid, ...business].sort((a, b) => a.rowNumber - b.rowNumber);
  return {
    dataRows, rows, totalRows: rawRows.length,
    eligibleCount: rows.filter((row) => row.eligible).length,
    invalidCount: rows.filter((row) => !row.eligible).length
  };
}
