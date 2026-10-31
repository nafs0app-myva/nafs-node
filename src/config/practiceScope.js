// The age groups and session formats a therapist can offer. Served by
// `GET /practice-scope/options?locale=en|ar` and used to validate `practice_scope`.
const AGE_GROUPS = [
  {
    id: 'children', icon: 'child',
    title: 'Children', title_ar: 'الأطفال',
    badge: 'Ages 6–12', badge_ar: 'من 6 إلى 12 سنة',
    description: 'Play therapy, behavioral challenges, separation anxiety, developmental support.',
    description_ar: 'العلاج باللعب، التحديات السلوكية، قلق الانفصال، دعم النمو.',
    warning: 'Specialized certification required', warning_ar: 'يتطلب شهادة تخصصية',
    requires_certification: true,
  },
  {
    id: 'adolescents', icon: 'school',
    title: 'Adolescents', title_ar: 'المراهقون',
    badge: 'Ages 13–17', badge_ar: 'من 13 إلى 17 سنة',
    description: 'Identity formation, academic pressure, emotional regulation, peer conflict, family dynamics.',
    description_ar: 'تكوين الهوية، الضغط الدراسي، تنظيم المشاعر، صراعات الأقران، الديناميكيات الأسرية.',
  },
  {
    id: 'adults', icon: 'person',
    title: 'Adults', title_ar: 'البالغون',
    badge: 'Ages 18–64', badge_ar: 'من 18 إلى 64 سنة',
    description: 'Anxiety, depressive disorders, career burnout, life transitions, grief, interpersonal conflict.',
    description_ar: 'القلق، اضطرابات الاكتئاب، الإرهاق المهني، التحولات الحياتية، الحزن، الصراعات الشخصية.',
  },
  {
    id: 'seniors', icon: 'elderly',
    title: 'Elderly & Seniors', title_ar: 'كبار السن',
    badge: 'Ages 65+', badge_ar: '65 سنة فأكثر',
    description: 'Bereavement, cognitive transitions, chronic illness coping, retirement adjustment.',
    description_ar: 'فقدان الأحبة، التغيرات المعرفية، التعايش مع الأمراض المزمنة، التكيف مع التقاعد.',
  },
];

const FORMATS = [
  { id: 'individual', icon: 'individual', title: 'Individual Therapy', title_ar: 'العلاج الفردي', description: '1-on-1 personalized sessions', description_ar: 'جلسات فردية مخصصة' },
  { id: 'couples', icon: 'heart', title: 'Couples Counseling', title_ar: 'الإرشاد الزوجي', description: 'Relationship dynamics & conflict resolution', description_ar: 'ديناميكيات العلاقة وحل النزاعات' },
  { id: 'family', icon: 'family', title: 'Family Therapy', title_ar: 'العلاج الأسري', description: 'Multi-member systemic resolution', description_ar: 'معالجة منهجية لعدة أفراد' },
  { id: 'group', icon: 'group', title: 'Group Circles', title_ar: 'الحلقات الجماعية', description: 'Curated psychoeducational circles', description_ar: 'حلقات توعوية نفسية منظمة' },
];

/** Options with the `*_ar` fields folded into `title` / `badge` / `description` / `warning` for the locale. */
function localize(options, locale) {
  return options.map(({ title_ar, badge_ar, description_ar, warning_ar, ...o }) =>
    locale === 'ar'
      ? { ...o, title: title_ar || o.title, badge: badge_ar || o.badge, description: description_ar || o.description, warning: warning_ar || o.warning }
      : o
  );
}

module.exports = {
  AGE_GROUPS,
  FORMATS,
  localize,
  AGE_GROUP_IDS: AGE_GROUPS.map((a) => a.id),
  FORMAT_IDS: FORMATS.map((f) => f.id),
};
