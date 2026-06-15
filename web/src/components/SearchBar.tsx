import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';

interface SearchBarProps {
  query: string;
  onQueryChange: (q: string) => void;
}

function SearchBar({ query, onQueryChange }: SearchBarProps) {
  return (
    <div className="relative mb-6">
      <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
      <Input
        type="search"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="Search recipes…"
        aria-label="Search recipes"
        className="pl-9"
      />
    </div>
  );
}

export default SearchBar;
