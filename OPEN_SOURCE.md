# Open Source & License Compliance

## Provenance

Postorizon is a **modified version** of the open-source project **Postiz**,
developed by Gitroom and published at
<https://github.com/gitroomhq/postiz-app> (upstream commit `23f29c4`, the base
of this fork).

## License

The upstream project is licensed under the **GNU Affero General Public License
v3.0 (AGPL-3.0)**. Postorizon is likewise distributed under AGPL-3.0. The full
license text is preserved verbatim in [`LICENSE`](LICENSE) at the root of this
repository, and all existing copyright and license notices in the source files
have been kept intact, as the license requires.

In particular, under AGPL-3.0 §13: if you run a modified version of this software
to provide a service over a network, you must offer the users of that service the
complete corresponding source code of the modified version under the same license.

## Source offer for the hosted Postorizon service

When the hosted Postorizon service (postorizon.com) launches, the complete
corresponding source of the modified version running in production will be made
available to its users at no charge, via a prominent "Source code" link in the
product and on the website, pointing to the public Postorizon source repository.
Until the service launches, this repository is that source.

## Trademarks

"Postiz" and "Gitroom" are names/marks of their respective owners. They appear in
this repository only where required for attribution, in license/copyright notices,
or in not-yet-migrated internal identifiers. They are **not** used as Postorizon
branding, and no affiliation or endorsement is implied.

## Modifications by Postorizon

Starting from upstream commit `23f29c4`, on branch `postorizon/phase-0`
(Phase 0 foundation — see `PHASE0_REPORT.md` for the detailed log):

- Product rebrand to **Postorizon**: root and commands package names, README,
  browser page titles, app logo components (Horizon arcs mark + lockups) and
  favicon set, browser-extension manifest name/description/connectable domain.
- Brand assets added under `apps/frontend/public/` (logo SVGs, favicon set) and
  the Postorizon design tokens added as `apps/frontend/src/app/postorizon.tokens.css`.
- Third-party reporting re-pointed/disabled so nothing reports to upstream
  (Postiz/Gitroom) services: Plausible and DataFast domains changed to
  postorizon.com; Dub.co analytics disabled in the app layout and its refer
  domain changed to postorizon.com. Remaining trackers (Sentry, GTM, Facebook
  pixel, Chatbase) are inert unless the operator sets their own keys via
  environment variables — none are configured by default.

This list will be extended as further modifications land, in line with the
AGPL-3.0 requirement to state prominent notices of modification.
