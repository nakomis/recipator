import { useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useAuth } from 'react-oidc-context';
import { Spinner } from '@/components/ui/spinner';

/**
 * OIDC redirect callback target. react-oidc-context completes the code
 * exchange in the background; once it settles we send the user home.
 */
function LoggedIn() {
  const auth = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!auth.isLoading) {
      void navigate({ to: '/' });
    }
  }, [auth.isLoading, navigate]);

  return (
    <div className="text-muted-foreground flex min-h-screen items-center justify-center gap-2 p-8">
      <Spinner /> Signing in…
    </div>
  );
}

export default LoggedIn;
