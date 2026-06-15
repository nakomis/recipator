import { cn } from '@/lib/utils';

/** Sentinel selection meaning "show every household member's recipes". */
export const EVERYONE = '__everyone__';

export interface Owner {
  userId: string;
  label: string;
}

interface OwnerFilterProps {
  owners: Owner[];
  value: string;
  onChange: (value: string) => void;
}

/**
 * Segmented control to scope the recipe list by owner — current user first, then
 * other household members, then "Everyone". Mirrors the iOS app's toolbar picker;
 * only shown to group members.
 */
function OwnerFilter({ owners, value, onChange }: OwnerFilterProps) {
  const options = [...owners, { userId: EVERYONE, label: 'Everyone' }];
  return (
    <div
      role="tablist"
      aria-label="Filter recipes by owner"
      className="bg-muted mb-6 inline-flex flex-wrap gap-1 rounded-lg p-1"
    >
      {options.map((opt) => {
        const selected = opt.userId === value;
        return (
          <button
            key={opt.userId}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(opt.userId)}
            className={cn(
              'rounded-md px-3 py-1 text-sm font-medium transition-colors',
              selected
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export default OwnerFilter;
