/** A radio hash width is in bytes; unknown width remains an ordinary public-key preview. */
export function shortNodeKey(publicKey: string | undefined, hashSize?: number): string | undefined {
  if (!publicKey) return undefined;
  const width = hashSize === 1 || hashSize === 2 || hashSize === 3 ? hashSize * 2 : 8;
  return publicKey.slice(0, width);
}
