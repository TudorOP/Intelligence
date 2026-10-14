# Intelligence — assets and provenance

Original generated branding and theme artwork are local assets under public/assets and build. Project-created artwork and the original support button are provided under the repository's GPL-3.0-only terms; third-party fonts/icons retain their own licenses. They are not downloaded at runtime. Ten themes share the same symbolic navigation system.

Festive, Tech, Astral and Marble each have an original nine-panel category atlas, nine isolated banner crops, a subtle background material and a standalone detailed welcome panorama. Their active still backgrounds now use detailed 1672×941 landscape reconstructions of the original materials, saved as public/assets/background-detail-{theme}.webp with originals in public/assets/originals. Built-in image_gen created these raster images. Final prompts/reference/output paths are recorded in public/assets/theme-provenance.json. Decorative animation and the hearth reference image are excluded from this source distribution.

Derivation scripts prepare WebP atlases/crops and welcome images; no external imagery is copied into the artwork. Existing theme assets and original branding remain preserved. Runtime consumes compressed images and loads only the chosen visual resources.

Lucide SVG symbols retain public/assets/icons/SOURCE.json and the complete local license. Inter, Lora, EB Garamond and JetBrains Mono retain their bundled OFL notices. Third-party source/content licenses remain independent from Intelligence's GPLv3 code license.

See docs/APPEARANCE.md for the design research and docs/LICENSES.md for distribution obligations.

The microphone.svg and grip.svg symbols are original, code-authored project vectors under GPL-3.0-only. Their source is retained beside the other UI symbols; they do not derive from the Lucide source recorded in SOURCE.json. Existing Lucide artwork and license/provenance are preserved.
