// Small parser regression inputs; never allocate a maximum-length sparse array
// or use enough nesting to exhaust the process even on an unpatched parser.
export const multipartFieldFixtures = [
  { name: 'deep multipart field', fields: [`payload${'[x]'.repeat(32)}`] },
  { name: 'crafted array index', fields: ['items[1001]', 'items[label]'] },
  { name: 'pathological field name', fields: ['items[-1]', 'items[]'] },
] as const;
