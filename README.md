# Juanjuarezarc.github.io

A minimal black-and-white portfolio, hosted on GitHub Pages, with a built-in **owner mode**:
log in, then drag, resize, upload and rewrite everything on the page — no code needed.
Every save is committed to this repository and goes live in about a minute.

## Logging in (one-time setup)

1. Create a GitHub token: <https://github.com/settings/personal-access-tokens/new>
   - **Repository access:** Only select repositories → `Juanjuarezarc.github.io`
   - **Permissions → Repository → Contents:** Read and write
   - Choose an expiration (e.g. 1 year) → **Generate token** → copy it
2. Go to **<https://juanjuarezarc.github.io/admin>** and paste the token.

The token is stored only in that browser. **Log out** in the dock removes it.
Treat it like a password — anyone with it can change this repository.

## Editing (owner mode)

| To… | Do this |
|---|---|
| Change any heading or paragraph | Click it and type |
| Bold / italic / link in About & Contact | Select text → use the small black bar |
| Add images or videos | **+ Image**, or drag files from Finder straight onto the grid |
| Replace an image | Drag a file onto it, or hover → **Replace** |
| Move a block | Drag it — it snaps to the grid |
| Resize a block | Drag the round handle at its bottom-right corner |
| Nudge / resize with keys | Arrow keys / Shift + arrows (on the selected block) |
| Add a text block | **+ Text** (double-click a text block to edit; **Aa** cycles the size) |
| Link a block to a project or website | Hover → **Link** |
| Create a new project page | **+ Project** → its tile appears on the Work grid → hover → **Open ↗** |
| Add your résumé | **Résumé** → choose a PDF (a link appears in the top menu) |
| See it the way visitors do | **Preview** |
| Save | **Save** or ⌘S |

- Big photos are scaled down automatically before upload (max 2800px) to keep the site fast.
- Files over 25 MB are refused — compress videos first.
- Every change is a commit, so any earlier version can be restored from the repo's history.

## Files

```
index.html     page shell
styles.css     look & feel — colors, font, spacing are at the very top
app.js         page behaviour, animations, owner mode
content.json   all your text and layout (edited by owner mode)
uploads/       your images, videos and PDFs
404.html       makes /admin and /p/<project> short links work
```

## Customizing the look

Open `styles.css`. The first block (`:root { … }`) controls the whole site:
colors, font, image corner rounding, the space between grid blocks and page width.

## Previewing on your Mac

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>. (Saving from there still commits to GitHub.)
