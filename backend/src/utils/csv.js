export function toCsv(rows) {
  return rows.map((row) => row.map((value) => {
    const raw = String(value ?? '');
    const text = /^[\s]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }).join(',')).join('\r\n');
}
