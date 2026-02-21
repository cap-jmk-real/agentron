# Nextra docs layout reference (from GitHub repos)

This file summarizes how **famous Nextra-based doc sites** structure their repos, so we can align Agentron docs with the same patterns.

## Sources

- **Nextra repo:** [shuding/nextra](https://github.com/shuding/nextra) — `examples/docs` and `examples/swr-site`
- **SWR site:** The live [swr.vercel.app](https://swr.vercel.app) is built from the `swr-site` example (i18n, same Layout/Navbar/Footer pattern)

---

## 1. Nextra `examples/docs` (minimal docs template)

**Repo layout:**

```
examples/docs/
├── next.config.mjs       # nextra({ latex, search, contentDirBasePath: '/docs' })
├── package.json
├── mdx-components.js
├── public/
└── src/
    ├── app/
    │   ├── layout.jsx    # Single root layout
    │   ├── page.jsx
    │   ├── docs/         # Docs route
    │   ├── blog/
    │   ├── _meta.js      # App-level meta
    │   ├── favicon.ico, icon.png, apple-icon.png
    │   └── ...
    └── content/          # MDX content
        ├── _meta.js      # Sidebar labels (index, get-started, features, …)
        ├── index.mdx
        ├── get-started.mdx
        ├── features/
        ├── themes/
        └── advanced/
```

**Root layout (`src/app/layout.jsx`):**

- Imports: `Footer`, `Layout`, `Navbar` from `nextra-theme-docs`; optional `Banner`, `Head` from `nextra/components`.
- **Navbar:** Logo is **text only** inside `Link`: e.g. "Nextra" + tagline "The Next Docs Builder". No logo image in the default example.
- **Footer:** One line, e.g. `MIT © {year} Nextra`.
- **Layout props:** `navbar`, `footer`, `pageMap` from `getPageMap()`, `docsRepositoryBase`, `editLink`, `sidebar={{ defaultMenuCollapseLevel: 1 }}`.
- **Styles:** Only `import 'nextra-theme-docs/style.css'` (no custom globals in the example).

**Content:**

- `_meta.js` in `content/`: object mapping route key → sidebar label (or config like `{ theme: { copyPage: false } }`).
- Top-level MDX: `index.mdx`, `get-started.mdx`, etc. Subfolders (e.g. `features/`, `advanced/`) for sections.

---

## 2. Nextra `examples/swr-site` (SWR docs, i18n)

**Repo layout:**

```
examples/swr-site/
├── next.config.ts
├── mdx-components.ts
├── public/
├── content/
│   ├── en/
│   ├── es/
│   └── ru/
└── app/
    ├── [lang]/
    │   ├── layout.tsx    # Layout per locale
    │   ├── [[...mdxPath]]/
    │   ├── styles.css    # Custom overrides
    │   └── ...
    ├── _components/
    ├── _icons/           # SwrIcon, VercelIcon for navbar
    ├── _dictionaries/
    ├── favicon.ico, icon.svg, apple-icon.png
    └── manifest.ts
```

**Layout (`app/[lang]/layout.tsx`):**

- Same pattern: `Layout`, `Navbar`, `Footer` from `nextra-theme-docs`; `Banner`, `Head` from `nextra/components`.
- **Navbar logo:** Custom icon component (`SwrIcon`) + text "SWR" inside `Link`. No big hero or repeated logo on inner pages.
- **Footer:** Uses dictionary (i18n). No logo in footer.
- **Sidebar:** Built from `pageMap` (and optional remote page maps). No extra hero block in content pages.
- **Custom CSS:** `styles.css` in the same folder for overrides.

**Content:**

- `content/en/`, `content/es/`, `content/ru/` — each locale has its own MDX tree. Sidebar and nav come from page map + _meta.

---

## 3. Patterns to follow (and how Agentron matches)

| Aspect | Nextra examples | Agentron docs |
|--------|------------------|---------------|
| **Single root layout** | One `layout.jsx` or `[lang]/layout.tsx` wrapping all docs | ✅ `app/layout.tsx` |
| **Navbar logo** | Text, or icon + text, inside `Link`; no image in default docs example | ✅ Logo image + "Agentron" in `Link` |
| **Footer** | One line (copyright / "Powered by") | ✅ One line |
| **Page content** | No logo or hero inside content; title from MDX (h1), then body | ✅ Download page: no hero logo; title "Download" from MDX |
| **Sidebar** | From `pageMap` + `_meta` in content folder | ✅ `content/_meta.ts`, `content/concepts/_meta.ts` |
| **Content structure** | `content/` (or `src/content/`) with `_meta`, index, sections | ✅ `content/` with `_meta.ts`, index.mdx, concepts/, etc. |
| **Static assets** | In `public/` (Next.js default) | ✅ `public/img/` for logo and OS icons |
| **Theme CSS** | Import theme; custom CSS minimal or in a single file | ✅ `globals.css` for overrides; theme imported there |
| **Sidebar width** | Not set in examples (theme default) | ✅ Custom `--nextra-sidebar-width: 14rem` |

---

## 4. Summary

- **Layout:** One root layout (or per-locale) with `Layout` + `Navbar` + `Footer`. Logo in navbar only (text or icon+text in Link).
- **Content pages:** No repeated logo or hero block; page title from MDX, then body. Download/page-specific UI (e.g. platform picker) is fine; no “weird” standalone logo in the content.
- **Content tree:** `content/` with `_meta` for sidebar labels and optional subfolders. Static files in `public/`.
- Agentron is already aligned with these patterns; the main fix was removing the duplicate logo from the download section and using `public/` for images so the navbar logo loads.
