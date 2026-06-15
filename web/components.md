# How the web stack fits together

A map of what each tool in the web dashboard is responsible for, and how the
styling/component layers relate. Useful when this project is cloned as a
template. For commands and folder conventions see [`README.md`](./README.md).

There are three groups: **tools that build the app**, **the engine that runs
it**, and **the layers that make the UI**. Most confusion lives in that last
group (Tailwind vs Radix vs shadcn), so it gets the most detail.

## The 10,000-foot view

```
   BUILD TIME (your machine / CI)          RUN TIME (the browser)
┌───────────────────────────────┐      ┌───────────────────────────┐
│ Vite  ← TypeScript, Biome,    │ ───► │ React → real DOM          │
│        Tailwind, Vitest       │      │ Radix behaviour + Tailwind │
│ (turns source → dist/)        │      │ styling = what you see    │
└───────────────────────────────┘      └───────────────────────────┘
```

## Who is responsible for what

| Piece | Job | Analogy |
|---|---|---|
| **Vite** | Dev server (instant reload while coding) + bundler (packs source into static `dist/` files to deploy). Everything else plugs into it. | The kitchen — ingredients in, finished dish out |
| **TypeScript** | The language. Adds types so mistakes are caught before the code runs. Vite strips the types to run; `tsc` does the checking. | The proofreader |
| **Biome** | Linter + formatter. Enforces style and catches sketchy code. Doesn't change what the app does. | The copy-editor |
| **Vitest** | Runs the tests. | QA |
| **React** | The UI engine. You write functions that return markup; React turns them into real on-screen elements and re-renders when data changes. | The engine |
| **Tailwind CSS** | Styling. Instead of separate `.css` files you put utility classes (`p-8`, `flex`, `bg-card`) on elements; Tailwind generates the actual CSS. | Pre-cut building materials |
| **Radix UI** | **Behaviour + accessibility** of interactive components — with *no looks*. A Radix dropdown handles keyboard nav, focus, open/close, screen-reader roles, and renders unstyled. | The mechanism/wiring |
| **shadcn/ui** | Not a dependency — **source files you own** that wire Radix (behaviour) to Tailwind (looks) into ready components. The CLI copies them into `src/components/ui/`. | Flat-pack furniture you assembled and now own |
| `cva` | Lets a component declare variants (button `default`/`destructive`, size `sm`/`lg`) mapped to class sets. | |
| `clsx` + `tailwind-merge` (`cn()`) | Combine class lists and resolve conflicts (last padding wins, etc.). | The screws |
| `lucide-react` | Icon set. | |
| Geist | The typeface. | |

## The key relationship: Radix vs Tailwind vs shadcn

Any button/dialog/dropdown has **two separate concerns**:

- **How it behaves** (a dialog traps focus, closes on Escape, is announced to
  screen readers) → **Radix** owns this. Radix gives a fully working but
  *visually naked* component.
- **How it looks** (colours, padding, rounded corners) → **Tailwind** owns
  this, via utility classes.

**shadcn is the glue.** Someone took Radix's naked components, dressed them in
Tailwind classes, and published the resulting *source code*. The shadcn CLI
doesn't install a library — it **copies that source into the repo**
(`src/components/ui/button.tsx`, etc.). From then on it is **our code**: no
hidden dependency, editable at will. That is why `src/components/ui/**` is
treated as *owned but vendored* — we own it, but regenerate via the CLI rather
than hand-tweak, so updates never fight Biome or the coverage gate.

> **Radix = behaviour, Tailwind = appearance, shadcn = the pre-assembled
> marriage of the two, living in our codebase.**

## Concrete trace: following a `<Button>`

Given `<Button size="sm">Refresh</Button>` in a component:

1. `Button` comes from `@/components/ui/button.tsx` — a shadcn file *in the repo*.
2. Inside it, **`cva`** maps `variant`/`size` to a string of **Tailwind**
   classes (e.g. `bg-primary h-8 px-3 rounded-md …`).
3. **`cn()`** (clsx + tailwind-merge, from `@/lib/utils`) merges those with any
   classes passed in, resolving conflicts.
4. Simple buttons render a plain `<button>`; richer primitives (dialog,
   dropdown) render **Radix** parts that supply the behaviour.
5. **React** turns that into a real DOM `<button class="bg-primary h-8 …">`.
6. **Tailwind** (run by Vite at build) has generated CSS so `bg-primary` means
   "the primary colour" — and `--primary` is defined in
   [`src/index.css`](./src/index.css)'s `:root` / `.dark` theme tokens. Because
   `<html class="dark">`, the dark value is used.
7. **Vite** bundled all of this into the `dist/assets/*.css` and `*.js` outputs.

## Build time vs run time

- **Build time:** Vite (with the React and Tailwind plugins) + TypeScript +
  Biome + Vitest take the source and produce static files in `dist/`.
- **Run time:** the browser loads those files; React renders components; Radix
  provides interaction behaviour; the Tailwind-generated CSS + theme tokens make
  them look right.

## Where the rest slots in

Things added later are pure run-time React sitting *alongside* the styling
layers, not replacing any of them:

- **TanStack Router** decides *which* component tree shows for a given URL.
- **react-oidc-context** is a React provider holding the signed-in Cognito user.
- **TanStack Query** + **Zodios**/**zod** fetch and validate API data.
