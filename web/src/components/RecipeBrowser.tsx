import { useEffect, useMemo, useState } from 'react';
import { useAuth } from 'react-oidc-context';
import {
  ownerFirstName,
  type RecipeSummary,
  useConfig,
  useRecipes,
  useSearchCorpus,
} from '@/api/client';
import OwnerFilter, { EVERYONE, type Owner } from '@/components/OwnerFilter';
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

/** The signed-in recipe list, scoped by owner (household members) and filtered by search. */
function RecipeBrowser({ query }: { query: string }) {
  const auth = useAuth();
  const recipes = useRecipes();
  const config = useConfig();

  const mySub = auth.user?.profile.sub ?? '';
  const myLabel = ownerFirstName(auth.user?.profile.email) ?? 'Me';

  const trimmed = query.trim();
  const searching = trimmed.length > 0;
  const corpus = useSearchCorpus(searching);

  const all = useMemo(() => recipes.data ?? [], [recipes.data]);

  // Show the owner picker only to household group members — non-members only ever
  // get their own recipes back from the server anyway. Mirrors the iOS app.
  const isInGroup = useMemo(
    () => !!mySub && (config.data ?? []).some((m) => m.userId === mySub),
    [config.data, mySub],
  );

  // Current user first, then each other distinct owner found in the recipes.
  const owners = useMemo<Owner[]>(() => {
    const result: Owner[] = [];
    const seen = new Set<string>();
    if (mySub) {
      seen.add(mySub);
      result.push({ userId: mySub, label: myLabel });
    }
    for (const r of all) {
      if (r.userId && !seen.has(r.userId)) {
        seen.add(r.userId);
        result.push({ userId: r.userId, label: ownerFirstName(r.userEmail) ?? r.userId });
      }
    }
    return result;
  }, [all, mySub, myLabel]);

  // Default to "my recipes"; seed the selection once the user's id is known.
  const [selectedOwner, setSelectedOwner] = useState('');
  useEffect(() => {
    if (!selectedOwner && mySub) setSelectedOwner(mySub);
  }, [selectedOwner, mySub]);

  const ownerScoped = useMemo(() => {
    if (!isInGroup || selectedOwner === EVERYONE || !selectedOwner) return all;
    return all.filter((r) => r.userId === selectedOwner);
  }, [all, isInGroup, selectedOwner]);

  const byId = useMemo(() => new Map(ownerScoped.map((r) => [r.recipeId, r])), [ownerScoped]);

  const shown: RecipeSummary[] = useMemo(() => {
    if (!searching) return ownerScoped;
    return searchRecipes(corpus.data ?? [], trimmed)
      .map((hit) => byId.get(hit.recipeId))
      .filter((r): r is RecipeSummary => Boolean(r));
  }, [searching, ownerScoped, corpus.data, trimmed, byId]);

  if (recipes.isLoading) return <GridSkeleton />;
  if (recipes.isError) {
    return (
      <p className="text-destructive text-sm">Couldn’t load recipes: {recipes.error.message}</p>
    );
  }

  return (
    <>
      {isInGroup && (
        <OwnerFilter owners={owners} value={selectedOwner} onChange={setSelectedOwner} />
      )}

      {searching && corpus.isLoading ? (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <Spinner /> Searching…
        </p>
      ) : shown.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {searching
            ? `No recipes match “${trimmed}”.`
            : 'No recipes here yet — save one from the iOS app or Chrome extension.'}
        </p>
      ) : (
        <RecipeGrid recipes={shown} showOwner={isInGroup && selectedOwner === EVERYONE} />
      )}
    </>
  );
}

export default RecipeBrowser;
