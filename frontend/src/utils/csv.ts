export function downloadCsv(filename: string, rows: (string | number)[][]) {
  const escapeCell = (value: string | number) => {
    const text = String(value);
    const safe = typeof value === 'string' && /^[\s\u0000-\u001f]*[=+\-@]/.test(text)
      ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  const csv = `\uFEFF${rows.map((row) => row.map(escapeCell).join(',')).join('\r\n')}`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
