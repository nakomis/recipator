import { Check, Circle, Plus, Trash2, X } from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';
import {
  type ShoppingItem,
  useAddShoppingItem,
  useClearTicked,
  useDeleteShoppingItem,
  useShoppingItems,
  useUpdateShoppingItem,
} from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { formatQuantity } from '@/lib/quantity';
import { groupByAisle, itemDisplay } from '@/lib/shopping';

function Row({
  item,
  onToggle,
  onDelete,
}: {
  item: ShoppingItem;
  onToggle: (item: ShoppingItem) => void;
  onDelete: (item: ShoppingItem) => void;
}) {
  const label = itemDisplay(item.item, formatQuantity(item.amount, item.unit));
  return (
    <li className="group flex items-center gap-2 py-1">
      <button
        type="button"
        onClick={() => onToggle(item)}
        aria-label={item.checked ? `Untick ${item.item}` : `Tick ${item.item}`}
        aria-pressed={item.checked}
        className="text-muted-foreground hover:text-foreground shrink-0"
      >
        {item.checked ? <Check className="text-primary size-5" /> : <Circle className="size-5" />}
      </button>
      <span
        className={
          item.checked ? 'text-muted-foreground flex-1 text-sm line-through' : 'flex-1 text-sm'
        }
      >
        {label}
      </span>
      <button
        type="button"
        onClick={() => onDelete(item)}
        aria-label={`Delete ${item.item}`}
        className="text-muted-foreground hover:text-destructive shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
      >
        <X className="size-4" />
      </button>
    </li>
  );
}

function ShoppingList() {
  const items = useShoppingItems();
  const add = useAddShoppingItem();
  const update = useUpdateShoppingItem();
  const del = useDeleteShoppingItem();
  const clear = useClearTicked();
  const [text, setText] = useState('');

  const all = useMemo(() => items.data ?? [], [items.data]);
  const unchecked = useMemo(() => all.filter((i) => !i.checked), [all]);
  const checked = useMemo(() => all.filter((i) => i.checked), [all]);
  const groups = useMemo(() => groupByAisle(unchecked), [unchecked]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || add.isPending) return;
    add.mutate(trimmed, { onSuccess: () => setText('') });
  };

  const toggle = (item: ShoppingItem) =>
    update.mutate({ itemId: item.itemId, patch: { checked: !item.checked } });
  const remove = (item: ShoppingItem) => del.mutate(item.itemId);

  return (
    <div className="mx-auto w-full max-w-2xl">
      <form onSubmit={submit} className="mb-6 flex gap-2">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add an item… e.g. 4 pints of milk"
          aria-label="Add a shopping-list item"
          disabled={add.isPending}
        />
        <Button type="submit" disabled={add.isPending || !text.trim()}>
          {add.isPending ? <Spinner /> : <Plus className="size-4" />}
          Add
        </Button>
      </form>

      {add.isError && (
        <p className="text-destructive mb-4 text-sm">Couldn’t add that: {add.error.message}</p>
      )}

      {items.isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder list
            <Skeleton key={i} className="h-7 w-full" />
          ))}
        </div>
      )}

      {items.isError && (
        <p className="text-destructive text-sm">Couldn’t load your list: {items.error.message}</p>
      )}

      {items.data && all.length === 0 && (
        <p className="text-muted-foreground text-sm">Your list is empty — add something above.</p>
      )}

      {groups.map((group) => (
        <section key={group.aisleId} className="mb-5">
          <h2 className="text-muted-foreground mb-1 text-xs font-semibold uppercase tracking-wide">
            {group.label}
          </h2>
          <ul className="divide-border/60 divide-y">
            {group.items.map((item) => (
              <Row key={item.itemId} item={item} onToggle={toggle} onDelete={remove} />
            ))}
          </ul>
        </section>
      ))}

      {checked.length > 0 && (
        <section className="mt-8 border-t pt-4">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
              Ticked ({checked.length})
            </h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => clear.mutate()}
              disabled={clear.isPending}
            >
              <Trash2 className="size-4" /> Clear ticked
            </Button>
          </div>
          <ul className="divide-border/60 divide-y">
            {checked.map((item) => (
              <Row key={item.itemId} item={item} onToggle={toggle} onDelete={remove} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export default ShoppingList;
