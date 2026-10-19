# Database designer (ThothBlueprint)

This directory is a prebuilt copy of **ThothBlueprint v0.0.11**, a visual database
schema designer by AHS12, licensed under the **GNU General Public License v3.0**
(see `LICENSE.md` here). It is not covered by Oddjob's Apache-2.0 licence.

Source: https://github.com/AHS12/thoth-blueprint/tree/0.0.11
(tag commit `59be8e89b438ff93aceed41afec8f78dc0b5b82a`).

Oddjob serves it as a separate page, `/database-designer`, and embeds it in an
iframe; no Oddjob code is linked into it.

## Modifications

The files here are the upstream production build, with these changes:

- `assets/index-D20pYvsO-embed-v6.js` is a copy of `assets/index-D20pYvsO.js`
  with the router basename and preload base changed from `/database-designer` to
  `/database-designer-embed`, and the service-worker registration replaced with a
  no-op.
- `embed-v5.html` is a copy of `index.html` that loads the assets from
  `/database-designer-embed/` and shows a startup error in the page if the bundle
  fails to load.
- `README.md` (this file) and `LICENSE.md` were added.

To rebuild from source, check out the tag above, run its build, and reapply the
two changes listed.
