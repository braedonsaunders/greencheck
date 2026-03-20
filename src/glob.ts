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

  // Escape regex special chars, then convert glob * to regex .*
  const escaped = escapeRegExp(normalizedPattern);
  const regexSource = escaped.replace(/\*/g, '.*');
  const regex = new RegExp(`^${regexSource}$`);

  // Match against full path
  if (regex.test(normalizedFile)) {
    return true;
  }

  // Match against basename (for patterns like *.lock, .env*)
  const basename = normalizedFile.split('/').pop() || normalizedFile;
  if (regex.test(basename)) {
    return true;
  }

  return false;
}
