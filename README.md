# FreePDF — free, private PDF editor

Fill forms, add text, tick boxes, draw shapes and sign PDFs in the browser.
Everything runs **on the user's device**: files are never uploaded, so hosting is a
plain static site (free on Vercel) with no server, storage, or per-use cost.

## Features

| Area | What you get |
| --- | --- |
| Fillable forms | Detects AcroForm fields (text, multiline, checkbox, radio, dropdown) and fills them natively. Optional "Flatten form" on download. |
| Text | Click anywhere to type. 5 fonts across categories: Helvetica (sans), Times (serif), Courier (mono), Kalam (handwriting), Dancing Script (script). Size, bold, italic, colour. Date stamp. |
| Form marks | Tick ✓, cross ✗ and radio dot ● for printed (non-fillable) forms. Resizable, recolourable. |
| Shapes | Box, circle/ellipse, line, arrow — stroke colour, stroke width, fill on/off, fill colour, opacity. Shift = square / circle / 45° snap. |
| Markup | Freehand pen, highlighter (multiply blend), whiteout. |
| Images | Insert PNG / JPEG / WebP / GIF. |
| Signatures & initials | Draw, type (4 signature fonts) or upload (with white-background removal). Black / blue / red ink. Saved on the device for reuse. |
| Editing | Move, resize, duplicate, bring to front / send to back, delete, undo / redo, arrow-key nudge, zoom. |
| Robustness | Handles rotated pages, crop-box offsets, and pages whose content leaks graphics state. Password-protected PDFs open after entering the password; encrypted PDFs export as a flattened copy. |

Keyboard: `V` select · `T` text · `D` date · `K` tick · `X` cross · `O` dot · `R` box · `E` circle · `L` line · `A` arrow · `P` draw · `H` highlight · `W` whiteout · `I` image · `S` sign · `N` initials · `Ctrl/⌘+Z` undo · `Ctrl/⌘+Shift+Z` redo · `Ctrl/⌘+D` duplicate · `Ctrl/⌘+S` download · `Del` delete · `Esc` cancel.

## How it compares (research summary)

Sejda and Smallpdf are the reference products. Their most-used editing features are the same
small set: add text, fill form fields, checkmarks, shapes/whiteout, highlight and draw, images,
and signatures (type / draw / upload) plus initials and dates. Both process files on their servers
and cap free use (Sejda: 3 tasks per hour, 50 pages, 50 MB; Smallpdf: limited free tasks, and editing
the PDF's original text requires Pro).

FreePDF covers that core set with no limits, because the work happens locally in the browser.
Not included (yet): editing text that's already in the PDF, adding links or new form fields,
and page tools (merge/split/rotate/reorder).

## Architecture

- **Rendering:** [pdf.js](https://github.com/mozilla/pdf.js) draws each page to a canvas (lazily, as you scroll).
- **Editing layer:** plain DOM/SVG overlay per page. Annotations are stored in PDF points with a
  top-left origin, so zoom is just a CSS transform.
- **Export:** [pdf-lib](https://github.com/Hopding/pdf-lib) writes the edits into the *original* PDF as vector content (text
  stays selectable, shapes stay sharp). A single transformation matrix maps the on-screen
  coordinate space into each page's user space, which is what makes rotated/cropped pages work.
- **Fast first load:** the landing page ships ~17 KB of script (gzipped). The PDF engines (pdf.js, pdf-lib) are
  separate chunks fetched only when someone opens a file, and signature-only fonts load when the dialog opens.
- **Shared geometry:** `src/shapes.js` produces the SVG path for each shape; the same path is
  drawn on screen and written to the PDF, so output matches what you see.

```
src/
  main.js       app shell: toolbar, property bar, shortcuts, open/download
  viewer.js     pdf.js loading, page rendering, form-field detection
  overlay.js    annotation rendering, selection, drag/resize, tools, form inputs
  exporter.js   pdf-lib export (+ flattened fallback for encrypted files)
  shapes.js     geometry shared by screen and export
  signature.js  signature/initials dialog
  fonts.js      font registry and text metrics
  state.js      state + undo/redo
  sample.js     generates the demo form
```

### Notes on fonts

pdf-lib's font subsetter drops glyphs from many fonts (Kalam, Caveat). Fonts are therefore
embedded whole unless subsetting is known to work for that file (Dancing Script, which
can't be embedded whole). The `subset` flag lives on each font in `src/fonts.js`. If you add
a font, check the exported PDF in a second viewer (e.g. Preview or Chrome).

The three standard fonts only cover Western European characters. Other characters are
replaced with `?` in the exported file. Arabic/Urdu etc. would need an embedded Unicode font.

## Develop

```bash
npm install
npm run dev
```

## Before you go live

```bash
npm run build      # production build into dist/
npm run preview    # serves dist/ on localhost with the same security headers as Vercel
```

`vercel.json` sets a strict Content-Security-Policy (everything from the same origin, no third-party
requests), HSTS, `no-referrer`, clickjacking protection, and long-lived caching for hashed assets.
`npm run preview` applies the same headers, so a policy change that breaks the app shows up locally.
If you add a CDN, analytics or an embedded iframe, update the policy in `vercel.json` first.

## Deploy to Vercel (free)

1. Push this folder to a GitHub repository.
2. In Vercel: **Add New → Project**, import the repo. The framework (Vite), build command
   (`npm run build`) and output directory (`dist`) are picked up from `vercel.json`.
3. Deploy. The Hobby plan is free, and there are no serverless functions or storage to bill.

Or use the CLI: `npx vercel` (then `npx vercel --prod`).

## Licences

pdf.js (Apache-2.0), pdf-lib (MIT), fontkit (MIT). Fonts: Kalam, Dancing Script, Caveat,
Great Vibes and Homemade Apple are from Google Fonts. Homemade Apple uses the Apache-2.0 licence and the others use
the SIL Open Font License. All are free to redistribute.
