import { useState } from 'react';
import { useExtract } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Save a recipe by pasting its URL. Note: the server fetches the page itself, so
 * bot-protected sites (Cloudflare etc.) may fail here — the iOS app and Chrome
 * extension get past those by sending the already-rendered page HTML.
 */
function AddRecipe() {
  const [url, setUrl] = useState('');
  const extract = useExtract();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed || extract.isPending) return;
    extract.mutate(trimmed, { onSuccess: () => setUrl('') });
  };

  return (
    <form onSubmit={submit} className="mb-6 flex flex-col gap-2">
      <div className="flex gap-2">
        <Input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste a recipe URL to save…"
          aria-label="Recipe URL"
          disabled={extract.isPending}
        />
        <Button type="submit" disabled={extract.isPending || !url.trim()}>
          {extract.isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>
      {extract.isError && (
        <p className="text-destructive text-sm">
          Couldn’t save that recipe: {extract.error.message}
        </p>
      )}
      {extract.isSuccess && (
        <p className="text-sm text-emerald-600 dark:text-emerald-400">
          Saved “{extract.data.title}”.
        </p>
      )}
    </form>
  );
}

export default AddRecipe;
