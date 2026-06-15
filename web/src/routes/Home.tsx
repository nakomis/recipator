import { type ReactNode, useState } from 'react';
import { useAuth } from 'react-oidc-context';
import AppHeader from '@/components/AppHeader';
import Footer from '@/components/Footer';
import RecipeBrowser from '@/components/RecipeBrowser';
import SearchBar from '@/components/SearchBar';
import SignInScreen from '@/components/SignInScreen';
import { Spinner } from '@/components/ui/spinner';
import { signOut } from '@/lib/auth';

function CenteredMessage({ children }: { children: ReactNode }) {
  return (
    <div className="text-muted-foreground flex min-h-screen items-center justify-center gap-2 p-8">
      {children}
    </div>
  );
}

function Home() {
  const auth = useAuth();
  const [query, setQuery] = useState('');

  if (auth.isLoading) {
    return (
      <CenteredMessage>
        <Spinner /> Loading…
      </CenteredMessage>
    );
  }

  if (auth.error) {
    return <CenteredMessage>Error: {auth.error.message}</CenteredMessage>;
  }

  if (!auth.isAuthenticated) {
    return <SignInScreen onSignIn={() => void auth.signinRedirect()} />;
  }

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader onSignOut={() => signOut(auth)} />
      <main className="mx-auto w-full max-w-5xl flex-1 p-6">
        <SearchBar query={query} onQueryChange={setQuery} />
        <RecipeBrowser query={query} />
      </main>
      <Footer />
    </div>
  );
}

export default Home;
