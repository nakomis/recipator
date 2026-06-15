import versionData from '@/version.json';

function Footer() {
  return (
    <footer className="text-muted-foreground border-t px-4 py-3 text-center text-xs">
      v{versionData.version} · Recipator
    </footer>
  );
}

export default Footer;
