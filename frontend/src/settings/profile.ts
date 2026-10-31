const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
export const nameLength = (name: string) => [...segmenter.segment(name.trim())].length;
export const initial = (name: string) => segmenter.segment(name)[Symbol.iterator]().next().value?.segment.toUpperCase() ?? '?';
