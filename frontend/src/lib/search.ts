/** Lower-case, accent-free, one output character per input character (so match offsets map back). */
export function fold(text: string): string {
  return Array.from(text, (char) => char.normalize("NFD")[0].toLowerCase()).join("")
}

/** [start, end) of every match of `query` in `text`, ignoring accents and case. */
export function matchRanges(text: string, query: string): [number, number][] {
  const needle = fold(query)
  if (!needle) return []
  const haystack = fold(text)
  const ranges: [number, number][] = []
  for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + needle.length)) {
    ranges.push([at, at + needle.length])
  }
  return ranges
}
