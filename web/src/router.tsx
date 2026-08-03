import { createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router';
import Home from '@/routes/Home';
import LoggedIn from '@/routes/LoggedIn';
import Logout from '@/routes/Logout';
import RecipeDetail from '@/routes/RecipeDetail';
import SearchInsights from '@/routes/SearchInsights';
import Shopping from '@/routes/Shopping';

const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: Home,
});

const loggedInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/loggedin',
  component: LoggedIn,
});

const logoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/logout',
  component: Logout,
});

const recipeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/recipes/$recipeId',
  component: RecipeDetail,
});

const shoppingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/shopping',
  component: Shopping,
});

const searchInsightsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/search-insights',
  component: SearchInsights,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  loggedInRoute,
  logoutRoute,
  recipeRoute,
  shoppingRoute,
  searchInsightsRoute,
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
