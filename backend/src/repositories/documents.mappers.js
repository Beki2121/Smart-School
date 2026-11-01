export function invalidDocument(message) {
  const error = new Error(message);
  error.status = 400;
  error.code = 'INVALID_DOCUMENT';
  return error;
}

export function isValidDocumentContent(mimeType, content) {
  if (mimeType === 'application/pdf') return content.subarray(0, 5).toString() === '%PDF-';
  if (mimeType === 'image/png') return content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mimeType === 'image/jpeg') return content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff;
  return false;
}

export function safeFilename(filename) {
  return String(filename).split(/[\\/]/).pop().replace(/[\r\n"]/g, '_').slice(0, 180) || 'admission-document';
}
