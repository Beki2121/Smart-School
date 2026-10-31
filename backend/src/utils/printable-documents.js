function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function printableDocument(title, content) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>@page{size:A4;margin:22mm}body{font-family:"Noto Sans Ethiopic",Arial,sans-serif;color:#17212b;line-height:1.6}h1{text-align:center}.actions{margin:1rem 0}@media print{.actions{display:none}}</style>
<body><div class="actions"><button onclick="window.print()">Print / Save as PDF</button></div><main>${content}</main></body></html>`;
}

export function offerLetterHtml(admission) {
  const nameEn = [admission.givenNameEn, admission.fatherNameEn, admission.grandfatherNameEn].join(' ');
  const nameAm = [admission.givenNameAm, admission.fatherNameAm, admission.grandfatherNameAm].join(' ');
  return printableDocument('Admission offer letter', `
    <h1>Admission Offer / የመግቢያ የቅበላ ደብዳቤ</h1>
    <p>Date / ቀን: ${new Date().toISOString().slice(0, 10)}</p>
    <p>Dear ${escapeHtml(admission.guardianName)}, / ውድ ${escapeHtml(admission.guardianName)},</p>
    <p>We are pleased to offer ${escapeHtml(nameEn)} (${escapeHtml(nameAm)}) admission to ${escapeHtml(admission.gradeName)}.</p>
    <p>ተማሪ ${escapeHtml(nameAm)} (${escapeHtml(nameEn)}), በ${escapeHtml(admission.gradeName)} እንዲማር ተቀብለናል።</p>
    <p>Please contact the registrar to complete enrolment and submit the remaining required documents.</p>
    <p>Registrar / ሬጅስትራር: ____________________</p>`);
}

export function transferCertificateHtml(record) {
  const student = record.student;
  const nameEn = [student.givenNameEn, student.fatherNameEn, student.grandfatherNameEn].join(' ');
  const nameAm = [student.givenNameAm, student.fatherNameAm, student.grandfatherNameAm].join(' ');
  return printableDocument('Student transfer certificate', `
    <h1>Transfer Certificate / የዝውውር ማስረጃ</h1>
    <p>${escapeHtml(record.campus.name)} · ${escapeHtml(record.campus.address)}</p>
    <p>Student ID / የተማሪ መለያ: ${escapeHtml(student.studentNo)}</p>
    <p>Name / ስም: ${escapeHtml(nameEn)} / ${escapeHtml(nameAm)}</p>
    <p>Transfer date / የዝውውር ቀን: ${escapeHtml(String(record.history.createdAt).slice(0, 10))}</p>
    <p>Reason / ምክንያት: ${escapeHtml(record.history.reason)}</p>
    <p>Principal signature / የርዕሰ መምህር ፊርማ: ____________________</p>`);
}
