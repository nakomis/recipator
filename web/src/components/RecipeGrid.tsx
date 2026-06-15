import { Link } from '@tanstack/react-router';
import { UtensilsCrossed } from 'lucide-react';
import type { RecipeSummary } from '@/api/client';
import { Card, CardContent } from '@/components/ui/card';

function RecipeCard({ recipe }: { recipe: RecipeSummary }) {
  return (
    <Link to="/recipes/$recipeId" params={{ recipeId: recipe.recipeId }} className="group">
      <Card className="h-full overflow-hidden p-0 transition-colors group-hover:border-ring">
        <div className="bg-muted aspect-video w-full overflow-hidden">
          {recipe.imageUrl ? (
            <img
              src={recipe.imageUrl}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover transition-transform group-hover:scale-105"
            />
          ) : (
            <div className="text-muted-foreground flex h-full w-full items-center justify-center">
              <UtensilsCrossed className="size-8" />
            </div>
          )}
        </div>
        <CardContent className="p-3">
          <h3 className="line-clamp-2 text-sm font-medium">{recipe.title}</h3>
        </CardContent>
      </Card>
    </Link>
  );
}

function RecipeGrid({ recipes }: { recipes: RecipeSummary[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {recipes.map((r) => (
        <RecipeCard key={r.recipeId} recipe={r} />
      ))}
    </div>
  );
}

export default RecipeGrid;
