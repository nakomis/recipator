import { Link } from '@tanstack/react-router';
import logo from '@/assets/recipator-logo.png';
import { Button } from '@/components/ui/button';

interface AppHeaderProps {
  onSignOut: () => void;
}

function AppHeader({ onSignOut }: AppHeaderProps) {
  return (
    <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
      <Link to="/" className="flex items-center gap-2">
        <img src={logo} alt="Recipator" className="h-9 w-9 rounded-lg" />
        <span className="text-lg font-semibold">Recipator</span>
      </Link>

      <Button variant="outline" size="sm" className="ml-auto" onClick={onSignOut}>
        Sign out
      </Button>
    </header>
  );
}

export default AppHeader;
