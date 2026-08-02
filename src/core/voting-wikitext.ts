export function repairVoteBelowMarker(line: string): string {
  if (!/^\s*<!--\s*Vote below this line\s*--\s*$/.test(line)) {
    return line;
  }

  return line.replace(/--\s*$/, "-->");
}

export function isUnexpandedVotePlaceholder(line: string): boolean {
  return /^\*\s*\{\{0\/3\*\}\}\s*--\s*~{4}\s*$/.test(line);
}
