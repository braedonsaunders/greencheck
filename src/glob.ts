function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

export function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '');
}

export function matchesGlob(file: string, pattern: string): boolean {
  const normalizedFile = normalizePath(file);
  const normalizedPattern = normalizePath(pattern);

  if (!normalizedFile || !normalizedPattern) {
    return false;
  }

  const source = `^${escapeRegExp(normalizedPattern).replace(/\\\*/g, '.*')}$`;
  const regex = new RegExp(source);
  const basename = normalizedFile.split('/').pop() || normalizedFile;

  return regex.test(normalizedFile) || regex.test(basename);
}
