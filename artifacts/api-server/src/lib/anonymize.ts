// KB and code anonymization helpers
export function anonymizeForKB(text: string): string {
  return text
    // Remove file paths
      .replace(/[A-Za-z]:[\/][\w/.-]+/g, '<PATH>')
    .replace(/([\w/\-.]+\.(ts|js|py|go|rs|java))/g, '<FILE>')
    // Remove class/function names (PascalCase and camelCase identifiers)
    .replace(/\b[A-Z][a-zA-Z]{3,}\b/g, '<CLASS>')
    .replace(/\b[a-z][a-zA-Z]{4,}\b/g, '<VAR>')
    // Remove string literals
    .replace(/"[^\"]{3,}"/g, '"<STRING>"')
    .replace(/'[^']{3,}'/g, "'<STRING>'")
    // Remove numbers that look like IDs or ports
    .replace(/\b\d{4,}\b/g, '<ID>')
    // Collapse whitespace
    .replace(/\s+/g, ' ').trim();
}

export function anonymizeCodeForAI(code: string): string {
  // Same as above, but keep enough structure for AI
  return anonymizeForKB(code);
}
