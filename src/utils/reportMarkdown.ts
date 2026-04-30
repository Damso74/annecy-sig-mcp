/** Lignes Markdown simples (pas d’interpolation HTML). */

export function mdH1(s: string): string {
  return `# ${s}\n\n`;
}

export function mdH2(s: string): string {
  return `## ${s}\n\n`;
}

export function mdH3(s: string): string {
  return `### ${s}\n\n`;
}

export function mdBullet(items: string[]): string {
  return items.map(i => `- ${i}`).join("\n") + "\n\n";
}

export function mdParagraph(s: string): string {
  return `${s.trim()}\n\n`;
}

/** Résumé exécutif standardisé (tests + cohérence des rapports). */
export function executiveSummaryHeading(): string {
  return "## Résumé exécutif\n\n";
}
