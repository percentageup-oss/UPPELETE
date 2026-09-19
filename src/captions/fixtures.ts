/** Authored text-only fixtures, not recordings or inferred transcripts. */
export const captionFixtures = [
  { id: 'vowel-signs', text: 'കി കീ കു കൂ കെ കേ കൈ കൊ കോ കൗ — React 19!', clusters: ['കി', 'കീ', 'കു', 'കൂ', 'കെ', 'കേ', 'കൈ', 'കൊ', 'കോ', 'കൗ'] },
  { id: 'conjuncts', text: 'മലയാളം: ക്ഷ ക്ര ത്ര ന്ത ക്ക ൻ ന്\u200d — API ready?', clusters: ['ക്ഷ', 'ക്ര', 'ത്ര', 'ന്ത', 'ക്ക', 'ൻ', 'ന്\u200d'] },
  { id: 'decomposed', text: 'കൊ ക\u0d46\u0d3e കൗ ക\u0d46\u0d57; cafe\u0301 👩🏽‍💻', clusters: ['ക\u0d46\u0d3e', 'ക\u0d46\u0d57', 'e\u0301', '👩🏽‍💻'] },
  { id: 'wrapping', text: 'മലയാളം subtitles ഉപയോഗിച്ച് React API preview പരിശോധിക്കാം. വാക്കുകൾ പിരിയരുത്!', clusters: [] },
  { id: 'punctuation', text: '“മലയാളം,” (English/API) — 50%… ശരിയല്ലേ? A\u00a0B A\u202fB', clusters: [] },
  { id: 'explicit', text: 'ആദ്യ വരി: React\r\nരണ്ടാം വരി: API\n\nഅവസാനം!  ', clusters: [] },
  { id: 'long-token', text: 'മലയാളംമലയാളംമലയാളംമലയാളംമലയാളംമലയാളംമലയാളം', clusters: [] },
] as const
