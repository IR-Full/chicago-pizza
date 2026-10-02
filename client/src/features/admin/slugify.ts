/**
 * A URL-safe slug from a Russian name.
 *
 * Lives outside the page that uses it because a file under `app/` may only
 * export `default` and the route-config fields Next recognises — exporting a
 * helper from one compiles clean under `tsc` and vitest, and then fails
 * `next build` with a type error about an index signature. A pure function has
 * no business in a page file anyway.
 *
 * Needed because the server requires a slug for every flavour and it has to be
 * stable: it is half of the `(productId, slug)` key the row is stored under.
 * Nobody should have to type "lime-mint" next to "Лайм-мята".
 *
 * Transliteration is crude on purpose — the slug is an identifier, not copy,
 * and the editor leaves it editable for the cases this gets wrong ("Кола"
 * becomes `kola`, where a person would have written `cola`).
 */
const CYRILLIC: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'h',
  ц: 'c',
  ч: 'ch',
  ш: 'sh',
  щ: 'sch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
};

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .split('')
    .map((char) => CYRILLIC[char] ?? char)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
