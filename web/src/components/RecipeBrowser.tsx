import { useMemo } from 'react';
import { type RecipeSummary, useRecipes, useSearchCorpus } from '@/api/client';
import RecipeGrid from '@/components/RecipeGrid';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { searchRecipes } from '@/lib/search';

function GridSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder list
        <Skeleton key={i} className="aspect-video w-full rounded-xl" />
      ))}
    </div>
  );
}

/** The signed-in recipe list, filtered by the search query when one is present. */
function RecipeBrowser({ query }: { query: string }) {
  const recipes = useRecipes();
  const trimmed = query.trim();
  const searching = trimmed.length > 0;
  const corpus = useSearchCorpus(searching);

  const all = useMemo(() => recipes.data ?? [], [recipes.data]);
  const byId = useMemo(() => new Map(all.map((r) => [r.recipeId, r])), [all]);

  const shown: RecipeSummary[] = useMemo(() => {
    if (!searching) return all;
    return searchRecipes(corpus.data ?? [], trimmed)
      .map((hit) => byId.get(hit.recipeId))
      .filter((r): r is RecipeSummary => Boolean(r));
  }, [searching, all, corpus.data, trimmed, byId]);

  if (recipes.isLoading) return <GridSkeleton />;
  if (recipes.isError) {
    return (
      <p className="text-destructive text-sm">Couldn’t load recipes: {recipes.error.message}</p>
    );
  }

  if (searching && corpus.isLoading) {
    return (
      <p className="text-muted-foreground flex items-center gap-2 text-sm">
        <Spinner /> Searching…
      </p>
    );
  }

  if (shown.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        {searching
          ? `No recipes match “${trimmed}”.`
          : 'No recipes yet — paste a URL above to save one.'}
      </p>
    );
  }

  return <RecipeGrid recipes={shown} />;
}

export default RecipeBrowser;
