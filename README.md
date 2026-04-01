# Artwork Flight Checker

A small preflight app for `PDF` and PDF-compatible `AI` files.

Current MVP checks:

- trim size from the PDF trim box
- bleed against allowed values of `1.5mm` or `2mm`
- a `3mm` internal safety zone
- detected colour operators such as `RGB`, `CMYK`, `Grayscale`, and some spot-colour markers
- raster image presence and best-effort effective DPI

## Run

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).
