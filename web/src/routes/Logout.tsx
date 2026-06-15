import { useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { Spinner } from '@/components/ui/spinner';

/** Post-logout landing route; bounces the user back home. */
function Logout() {
  const navigate = useNavigate();

  useEffect(() => {
    void navigate({ to: '/' });
  }, [navigate]);

  return (
    <div className="text-muted-foreground flex min-h-screen items-center justify-center gap-2 p-8">
      <Spinner /> Signing out…
    </div>
  );
}

export default Logout;
