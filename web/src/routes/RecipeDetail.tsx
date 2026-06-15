import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { ArrowLeft, ExternalLink, Trash2 } from 'lucide-react';
import { useAuth } from 'react-oidc-context';
import { useDeleteRecipe, useRecipe } from '@/api/client';
import SignInScreen from '@/components/SignInScreen';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

function RecipeDetail() {
  const auth = useAuth();
  const navigate = useNavigate();
  const { recipeId } = useParams({ from: '/recipes/$recipeId' });
  const recipe = useRecipe(auth.isAuthenticated ? recipeId : '');
  const del = useDeleteRecipe();

  if (auth.isLoading) {
    return (
      <div className="text-muted-foreground flex min-h-screen items-center justify-center gap-2 p-8">
        <Spinner /> Loading…
      </div>
    );
  }

  if (!auth.isAuthenticated) {
    return <SignInScreen onSignIn={() => void auth.signinRedirect()} />;
  }

  const onDelete = () => {
    if (!window.confirm('Delete this recipe?')) return;
    del.mutate(recipeId, { onSuccess: () => void navigate({ to: '/' }) });
  };

  return (
    <div className="mx-auto w-full max-w-3xl p-6">
      <Link
        to="/"
        className="text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" /> All recipes
      </Link>

      {recipe.isLoading && (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <Spinner /> Loading recipe…
        </p>
      )}
      {recipe.isError && (
        <p className="text-destructive text-sm">
          Couldn’t load this recipe: {recipe.error.message}
        </p>
      )}

      {recipe.data && (
        <article className="flex flex-col gap-6">
          {recipe.data.imageUrl && (
            <img
              src={recipe.data.imageUrl}
              alt=""
              className="bg-muted aspect-video w-full rounded-xl object-cover"
            />
          )}

          <header className="flex flex-col gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{recipe.data.title}</h1>
            {recipe.data.url && (
              <a
                href={recipe.data.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1 text-sm"
              >
                <ExternalLink className="size-4" /> View original
              </a>
            )}
          </header>

          {recipe.data.ingredients?.length > 0 && (
            <section>
              <h2 className="mb-2 text-lg font-semibold">Ingredients</h2>
              <ul className="list-inside list-disc space-y-1 text-sm">
                {recipe.data.ingredients.map((ing, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: ingredients are a static ordered list
                  <li key={i}>{ing}</li>
                ))}
              </ul>
            </section>
          )}

          {recipe.data.method?.length > 0 && (
            <section>
              <h2 className="mb-2 text-lg font-semibold">Method</h2>
              <ol className="list-inside list-decimal space-y-2 text-sm">
                {recipe.data.method.map((step, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: method steps are a static ordered list
                  <li key={i}>{step}</li>
                ))}
              </ol>
            </section>
          )}

          <div className="border-t pt-4">
            <Button variant="destructive" size="sm" onClick={onDelete} disabled={del.isPending}>
              <Trash2 className="size-4" /> {del.isPending ? 'Deleting…' : 'Delete recipe'}
            </Button>
            {del.isError && (
              <p className="text-destructive mt-2 text-sm">Couldn’t delete: {del.error.message}</p>
            )}
          </div>
        </article>
      )}
    </div>
  );
}

export default RecipeDetail;
