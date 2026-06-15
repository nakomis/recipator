import { Link } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import logo from '@/assets/recipator-logo.png';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface AppHeaderProps {
  query: string;
  onQueryChange: (q: string) => void;
  onSignOut: () => void;
}

function AppHeader({ query, onQueryChange, onSignOut }: AppHeaderProps) {
  return (
    <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
      <Link to="/" className="flex items-center gap-2">
        <img src={logo} alt="Recipator" className="h-9 w-9 rounded-lg" />
        <span className="text-lg font-semibold">Recipator</span>
      </Link>

      <div className="relative ml-auto w-full max-w-xs">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
        <Input
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search recipes…"
          aria-label="Search recipes"
          className="pl-8"
        />
      </div>

      <Button variant="outline" size="sm" onClick={onSignOut}>
        Sign out
      </Button>
    </header>
  );
}

export default AppHeader;
