import { Student } from '../api';

type T = (key: string) => string;

export default function StudentTable({ students, t, onSelect }: {
  students: Student[]; t: T; onSelect?: (student: Student) => void
}) {
  if (!students.length) return <div className="empty-state">{t('emptyStudents')}</div>;
  return <div className="table-scroll"><table className="data-table"><thead><tr><th>{t('student')}</th><th>{t('studentNumber')}</th><th>{t('section')}</th><th>{t('gender')}</th><th>{t('state')}</th><th /></tr></thead><tbody>{students.map((student) => <tr key={student.id}>
    <td><div className="student-cell"><span className="student-avatar">{student.givenNameEn.slice(0, 1)}</span><span><strong>{student.givenNameEn} {student.fatherNameEn} {student.grandfatherNameEn}</strong><small>{student.givenNameAm} {student.fatherNameAm} {student.grandfatherNameAm}</small></span></div></td>
    <td><span className="student-number">{student.studentNo}</span></td><td>{student.sectionName || t('sectionGrade')}</td><td>{student.gender === 'female' ? t('female') : student.gender === 'male' ? t('male') : t('other')}</td><td><span className="status-pill">{t(student.status)}</span></td><td>{onSelect && <button className="button button-quiet" onClick={() => onSelect(student)}>{t('studentProfile')}</button>}</td>
  </tr>)}</tbody></table></div>;
}
