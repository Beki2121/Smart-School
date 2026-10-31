const subjects = {
  localLanguage: ['LOCAL', 'Local Language', 'የአካባቢ ቋንቋ', 5],
  english: ['ENG', 'English', 'እንግሊዝኛ', 4],
  mathematics: ['MAT', 'Mathematics', 'ሂሳብ', 5],
  environmentalScience: ['ENV', 'Environmental Science', 'አካባቢ ሳይንስ', 3],
  generalScience: ['SCI', 'General Science', 'አጠቃላይ ሳይንስ', 4],
  socialStudies: ['SOC', 'Social Studies', 'ማህበራዊ ጥናት', 3],
  arts: ['ART', 'Arts', 'ስነ-ጥበብ', 2],
  physicalEducation: ['PE', 'Health and Physical Education', 'የጤናና አካል ብቃት', 2],
  civicEducation: ['CIV', 'Civic and Ethical Education', 'የዜግነትና ስነ-ምግባር ትምህርት', 2],
  ict: ['ICT', 'Information and Communication Technology', 'የመረጃና መገናኛ ቴክኖሎጂ', 2],
  biology: ['BIO', 'Biology', 'ባዮሎጂ', 3],
  chemistry: ['CHEM', 'Chemistry', 'ኬሚስትሪ', 3],
  physics: ['PHY', 'Physics', 'ፊዚክስ', 3],
  geography: ['GEO', 'Geography', 'ጂኦግራፊ', 3],
  history: ['HIS', 'History', 'ታሪክ', 3],
  economics: ['ECO', 'Economics', 'ኢኮኖሚክስ', 3],
  numeracy: ['NUM', 'Early Numeracy', 'ቀደምት የቁጥር ክህሎት', 4],
  environmentalAwareness: ['EVA', 'Environmental Awareness', 'የአካባቢ ግንዛቤ', 3],
  creativeArts: ['CRA', 'Creative Arts', 'ፈጠራ ስነ-ጥበብ', 2],
  lifeSkills: ['LIF', 'Life Skills', 'የሕይወት ክህሎት', 2]
};

const definitions = [
  ...Array.from({ length: 10 }, (_, index) => {
    const grade = index + 1;
    return {
      code: `G${grade}`, nameEn: `Grade ${grade}`, nameAm: `${grade}ኛ ክፍል`,
      band: grade <= 8 ? 'primary' : 'secondary', sortOrder: grade,
      subjects: grade <= 4
        ? ['localLanguage', 'english', 'mathematics', 'environmentalScience', 'arts', 'physicalEducation', 'civicEducation']
        : grade <= 8
          ? ['localLanguage', 'english', 'mathematics', 'generalScience', 'socialStudies', 'ict', 'arts', 'physicalEducation', 'civicEducation']
          : ['localLanguage', 'english', 'mathematics', 'biology', 'chemistry', 'physics', 'geography', 'history', 'civicEducation', 'ict', 'physicalEducation']
    };
  }),
  {
    code: 'G11', nameEn: 'Grade 11', nameAm: '11ኛ ክፍል', band: 'secondary', sortOrder: 11,
    subjectsByStream: {
      natural_science: ['localLanguage', 'english', 'mathematics', 'biology', 'chemistry', 'physics', 'ict', 'civicEducation'],
      social_science: ['localLanguage', 'english', 'mathematics', 'geography', 'history', 'economics', 'ict', 'civicEducation']
    }
  },
  {
    code: 'G12', nameEn: 'Grade 12', nameAm: '12ኛ ክፍል', band: 'secondary', sortOrder: 12,
    subjectsByStream: {
      natural_science: ['localLanguage', 'english', 'mathematics', 'biology', 'chemistry', 'physics', 'ict', 'civicEducation'],
      social_science: ['localLanguage', 'english', 'mathematics', 'geography', 'history', 'economics', 'ict', 'civicEducation']
    }
  }
];

export const SCHOOL_GRADE_CATALOG = Object.freeze(definitions.map(({ subjects: _subjects, subjectsByStream: _streams, ...grade }) => grade));
export const DEFAULT_GRADING_BANDS = Object.freeze([
  { code: 'A', nameEn: 'Excellent', nameAm: 'በጣም ጥሩ', minPercent: 80 },
  { code: 'B', nameEn: 'Very Good', nameAm: 'በጣም ጥሩ', minPercent: 70 },
  { code: 'C', nameEn: 'Good', nameAm: 'ጥሩ', minPercent: 60 },
  { code: 'D', nameEn: 'Satisfactory', nameAm: 'የሚያረካ', minPercent: 50 },
  { code: 'F', nameEn: 'Needs Support', nameAm: 'ተጨማሪ ድጋፍ ያስፈልጋል', minPercent: 0 }
]);

export function getGradeTemplate(code) {
  const definition = definitions.find((grade) => grade.code === code);
  if (!definition) return null;
  const mapSubjects = (keys, stream = 'all') => keys.map((key) => {
    const [subjectCode, nameEn, nameAm, weeklyPeriods] = subjects[key];
    return { code: subjectCode, nameEn, nameAm, weeklyPeriods, stream };
  });
  return {
    grade: { code: definition.code, nameEn: definition.nameEn, nameAm: definition.nameAm, band: definition.band, sortOrder: definition.sortOrder },
    subjects: definition.subjects
      ? mapSubjects(definition.subjects)
      : Object.entries(definition.subjectsByStream).flatMap(([stream, keys]) => mapSubjects(keys, stream))
  };
}

export function isUpperSecondaryGrade(code) {
  return code === 'G11' || code === 'G12';
}
