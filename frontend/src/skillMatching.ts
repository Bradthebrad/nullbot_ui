export type SkillMetadata = {name: string; path: string; description?: string; keywords?: string[] | string};
export type SkillMatch = SkillMetadata & {matchedWords: string[]};
const ignored = new Set(('the and for with this that please use using skill skills when from into your you our are can will have has not all any only other more should would could about based support supports tool tools file files local read write create new help need want work working').split(' '));
function tokens(value: string): string[] {
  return (value.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter(word => word.length >= 3 && !ignored.has(word));
}
export function matchSkills(input: string, skills: SkillMetadata[], limit = 5): SkillMatch[] {
  const words = new Set(tokens(input));
  if (!words.size) return [];
  const seen = new Set<string>();
  const candidates: Array<{match: SkillMatch; score: number}> = [];
  for (const skill of skills) {
    if (!skill.path || seen.has(skill.path)) continue;
    seen.add(skill.path);
    const explicit = Array.isArray(skill.keywords) ? skill.keywords.join(' ') : skill.keywords || '';
    const names = new Set(tokens(`${skill.name} ${explicit}`));
    const metadata = new Set([...names, ...tokens(skill.description || '')]);
    const matchedWords = [...words].filter(word => metadata.has(word));
    if (!matchedWords.length) continue;
    candidates.push({match: {...skill, matchedWords}, score: matchedWords.reduce((sum, word) => sum + (names.has(word) ? 10 : 1), 0)});
  }
  return candidates.sort((a, b) => b.score - a.score || a.match.name.localeCompare(b.match.name)).slice(0, limit).map(item => item.match);
}
export function highlightSkillWords(input: string, matches: SkillMatch[]) {
  const matched = new Set(matches.flatMap(skill => skill.matchedWords));
  return input.split(/([\p{L}\p{N}]+)/gu).filter(Boolean).map(text => ({text, highlighted: matched.has(text.toLocaleLowerCase())}));
}
