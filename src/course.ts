export interface Item { hear: string | null; say: string; en: string; es: string; ph: string; why: string; lang: string; }
export interface Lesson { id: string; title: string; items: Item[]; }
export interface Course { tracks: { id: string; name: string; sections: { cefr: string; units: { id: string; title: string; lessons: Lesson[] }[] }[] }[]; }
export interface Row { key: string; track: string; lesson: string; title: string; index: number; item: Item; }
export function rows(course: Course): Row[] {
  return course.tracks.flatMap(t => t.sections.flatMap(s => s.units.flatMap(u => u.lessons.flatMap(l => l.items.map((item, index) => ({ key: `${t.id}::${l.id}::${index}`, track: t.id, lesson: l.id, title: l.title, index, item }))))));
}
// Text-only Portugal subset. Omit inherited phonetic hints: they do not reliably describe pt-PT.
export const portugalKeys = new Set(['flirt::rp1::2', 'flirt::rp1::4', 'flirt::rp2::2', 'flirt::rp2::4', 'flirt::fd2::0']);
export const pilot: Row[] = [
  ['Bonjour, je m’appelle Alex.', 'Hello, my name is Alex.', 'Hola, me llamo Alex.'],
  ['Je suis programmeur.', 'I am a programmer.', 'Soy programador.'],
  ['Je travaille dans une entreprise de systèmes informatiques et d’intelligence artificielle.', 'I work at a company specialising in computer systems and artificial intelligence.', 'Trabajo en una empresa de sistemas informáticos e inteligencia artificial.'],
  ['Nous développons des outils pour les entreprises.', 'We develop tools for businesses.', 'Desarrollamos herramientas para empresas.'],
  ['Pouvez-vous répéter plus lentement, s’il vous plaît ?', 'Could you repeat more slowly, please?', '¿Puede repetir más despacio, por favor?'],
  ['Et vous, sur quoi travaillez-vous ?', 'And you, what are you working on?', '¿Y usted, en qué trabaja?']
].map(([say, en, es], index) => ({ key: `fr::intro-pilot-v1::${index}`, track: 'fr', lesson: 'intro-pilot-v1', title: 'A programmer’s introduction', index, item: { hear: null, say, en, es, ph: '', why: 'Original authored French pilot. Formal vous; programmeuse is the feminine form.', lang: 'fr' } }));
export function forLanguage(all: Row[], lang: string): Row[] {
  return all.filter(r => r.item.lang === lang && (lang !== 'pt' || portugalKeys.has(r.key)));
}
export function normalize(text: string): string { return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[’']/g, '').replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim(); }
