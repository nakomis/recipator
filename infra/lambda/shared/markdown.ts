// The stored `markdown` rendering of a recipe, shared by /extract (initial capture)
// and PATCH /recipes/{id} (edits, RECP-59) so an edited recipe's markdown — which is
// what ShareLink shares out of the app — stays in the same shape as a captured one.

export interface RecipeContent {
  title: string;
  ingredients: string[];
  method: string[];
  /// Free-text notes added by hand in the app; omitted from the markdown when empty.
  notes?: string;
}

export function buildMarkdown(recipe: RecipeContent, url: string): string {
  let md = `# ${recipe.title}\n\nSource: ${url}\n\n## Ingredients\n\n`;
  for (const i of recipe.ingredients) md += `- ${i}\n`;
  md += '\n## Method\n\n';
  for (let i = 0; i < recipe.method.length; i++) md += `${i + 1}. ${recipe.method[i]}\n`;
  if (recipe.notes?.trim()) md += `\n## Notes\n\n${recipe.notes.trim()}\n`;
  return md;
}
