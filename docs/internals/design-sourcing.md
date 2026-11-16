# Design sourcing register

The remodel borrows motion recipes, effects, icons and fonts from outside sources. Most of them
are not npm packages, so the generated [license manifest](open-source-licenses.md) cannot see
them. This page is the gate: a screen task checks it before adopting a recipe, and the change that
lands borrowed work adds or updates its row here, plus a `customNotices` entry when one is owed.

This page records licence facts as read on the date given. It is not legal advice. Where a text is
ambiguous, the ambiguity is written down and left to the maintainer.

## Policy

E6 is open at the core, so a fork should inherit only OSI or OFL terms on code and fonts, and only
redistributable terms on any other file. That rules out committing code whose licence restricts
redistribution. There are two named exceptions:

- **CC BY media** is allowed in `apps/marketing` with its credit (below).
- **`gsap`** is allowed as an npm dependency under D1. A fork that keeps it inherits Webflow's
  Standard no-charge terms, not an open-source licence: Webflow can amend them for future versions
  and terminate them on non-compliance, and they say nothing about forks (see Licence facts). A fork
  that removes `gsap` sheds those terms, and keeping it to the import paths below keeps that removal
  small.

- **MIT, ISC and OFL sources** may be used, copied with their notice, and listed in Settings > Open
  source licenses.
- **Primitives are built over Base UI** (`@base-ui/react`) in `apps/web/src/next/ui`.
- **transitions.dev free recipes are reference only** (decided 2026-11-15). They are not MIT (see
  below). Each adopted preset is written from the idea in `next/motion` with our tokens and
  credited here. No recipe code is copied. The transitions.dev `LICENSE` puts every published
  snippet under the Transitions.dev License. Our reading, not legal advice: copied code would keep
  that licence inside an MIT repository.
- **React Bits is reference only** (D3, decided 2026-11-15). No React Bits source or shader enters
  the repository, and nothing is installed with `npx shadcn add` from reactbits.dev. An effect is
  written from the idea and credited here. It must not be a translation of React Bits code,
  because the licence forbids redistribution "as a ported version".
- **Off-limits in the app**, whatever the source:
  - WebGL backgrounds other than the ambient shader on its listed screens;
  - cursor effects, Glass Surface and Fluid Glass;
  - Click Spark and particle bursts;
  - anything that needs `matter-js` or `three`;
  - Sound Lab sounds;
  - Dock-style magnification;
  - components that depend on Hugeicons.
- **`motion` is the default animation engine** (D1, decided 2026-11-16). **`gsap`** is used only
  for authored timelines (launch, onboarding, celebrations), loaded lazily, never on the chat
  critical path. It is imported only under `next/motion/cinematic` in the app and in
  `apps/marketing`, lazily there too. `gsap` does not follow reduced motion by itself, so every
  sequence runs under MotionPolicy. ScrollTrigger, SplitText and MorphSVG are not approved inside
  the app; using one needs its own decision. Anime.js stays behind the legacy `lib/motion.ts` until
  its last legacy caller is deleted.
- **Paid sources** (transitions.dev Pro and Motion Agent, React Bits Pro, Hugeicons Pro) are not
  bought or used (D4, decided 2026-11-15).
- **CC BY assets** (pictures, Solar icons) are marketing only, with a visible credit on the page.
- **Every sound asset needs a row here** (source, licence, changes) before it lands. The UI sound
  layer from D9 follows this rule. React Bits Sound Lab is reference only, under D3.

Check that no React Bits code has entered the repository:

```bash
git grep -n -i -E 'reactbits|react bits|react-bits|commons clause' -- . ':!.repos' \
  ':!docs/internals/design-sourcing.md'
```

On 2026-11-15 this matched only a planning note in `remodel-backlog/E25/E25-T15.md`, not code.

## Licence facts

All sources below were read on 2026-11-15.

**GSAP Standard "no charge" licence.** Read at <https://gsap.com/standard-license>: effective
30 April 2025, last modified 30 May 2025, licensor Webflow. npm `gsap` 3.15.1 points its `license`
field at this page, and its tarball has no licence file. The licence grants free use on "any
website, web application, or digital interface", commercial use included, with every plugin. The
grant covers using, reproducing, displaying and implementing GSAP. It does not mention
distribution, sublicensing, open-source projects or forks. There are three restrictions:

- no "Prohibited Uses" without written consent, meaning no-code visual animation tools that
  compete with Webflow's animation builder;
- no reverse engineering to build "Competitive Products";
- no removing or altering notices or branding.

If you fail to comply, Webflow may terminate the licence, and you must then destroy all copies.
Webflow may amend the licence at any time by posting new terms, provided an update does not cause
"material degradation" to the security, integrity or functionality of GSAP. If you reject the new
terms, you may not use versions released after the change, but earlier versions keep their
earlier terms. Webflow keeps all IP.
The licence incorporates Webflow's [Terms of Service](https://webflow.com/legal/terms) (effective
15 November 2023, California law), and the GSAP licence governs where the two conflict. Our reading,
not legal advice: a fork that keeps a GSAP dependency also takes on these terms, which Webflow
can change for future versions and which E6's MIT licence does not cover. `@gsap/react` 2.1.2 says "SEE LICENSE AT" the same page.

**React Bits.** Read at the repository's `LICENSE.md`
([DavidHDev/react-bits@cf28010](https://github.com/DavidHDev/react-bits/blob/cf2801031f07f53d4684e65b961bde7c2e2a6921/LICENSE.md)):
MIT with Commons Clause v1.0, © 2026 David Haz. Two points differ from plain MIT:

- The grant to copy, publish and distribute applies only "as part of an application, website, or
  product".
- The components may not be sold, sublicensed or redistributed "alone, in a bundle, or as a ported
  version".

The same restriction covers the tools (Sound Lab included) and the sounds library. The tools, or a
substantially similar copy, also may not be offered "as a hosted service". The text attaches the
hosted-service ban to the tools, not the components. Exports from
the tools may ship inside a product, but not as packs. _Ambiguous:_ the text does not define
"ported version". It does not say whether an effect written independently from a React Bits
demo counts as a port, or whether committing component source to a public MIT repository counts
as redistribution.

**React Bits Pro.** Read at <https://pro.reactbits.dev/license>: React Bits Pro License Agreement
v2.2, 11 September 2026. It is one licence per developer. Publishing the product or a substantial
part of it is prohibited, and open-source repositories are named explicitly. Not used.

**transitions.dev.** Read at the repository's `LICENSE` and `README`
([Jakubantalik/transitions.dev@20d70c1](https://github.com/Jakubantalik/transitions.dev/blob/20d70c1262bf721c0300c2946cbe1fc7605a555c/LICENSE)),
<https://transitions.dev/terms.html> (last updated 10 October 2026) and
<https://transitions.dev/pro.html>. The repository has two licences:

- **Tooling is MIT.** This covers `agent/`, `cli/`, `cli-legacy/`, `refine/`, `build/` and
  `scripts/`.
- **Transitions and skills use the custom Transitions.dev License**, © 2026 Jakub Antalik. This
  covers every snippet published on the site. It allows use in unlimited personal and commercial
  projects, modification, and shipping to end users. It forbids publishing the collection "or a
  substantial part of it" as a competing library, motion pack or animation kit.

The licence has no SPDX id, so `generatedNotices` cannot render it. Templates and kits that use
transitions need a paid plan and must keep "the transitions.dev comment" in each transition's
code. The vendor may update the terms. Account holders get at least 14 days' email notice of
material changes only, and the terms are governed by Czech law. Pro and Business are paid plans. Under the
`LICENSE`, Business is required when Pro transitions or paid agent features are used for a
company.

_Ambiguous:_

- `pro.html` still calls the free set "MIT core transitions". The `LICENSE` and the terms say the
  transitions are not MIT.
- `pro.html` lists React and TypeScript variants under Pro, and the free set as CSS snippets.
- The `LICENSE` says the free transitions "need no plan, for anyone, including companies". The
  terms page does not repeat this, and `pro.html` sells Business as the plan "for companies and
  teams".
- Neither text says whether a public MIT repository that ports a dozen recipes is publishing "a
  substantial part" of the collection.

**motion.** npm `motion` 14.14.0, `license: MIT`. The tarball's `LICENSE.md` is MIT, © 2024 Motion
B.V. It matches the repository `LICENSE.md` at
[motiondivision/motion@f95ab94](https://github.com/motiondivision/motion/blob/f95ab9418d9524b906c8681994b95d15cb03d5fc/LICENSE.md).

**Phosphor.** npm `@phosphor-icons/core` 2.1.1, `license: MIT`. The tarball's `LICENSE` is MIT,
© 2023 Phosphor Icons, the same as
[phosphor-icons/core@2b75f3a](https://github.com/phosphor-icons/core/blob/2b75f3ad12b420c9504ef05df8d2564a28f8500e/LICENSE).
No attribution beyond the MIT notice is required.

**Geist and Geist Mono.** npm `@fontsource-variable/geist` and `@fontsource-variable/geist-mono`
are both 5.3.0, `license: OFL-1.1`, with an OFL `LICENSE` file in each tarball. Upstream is
[vercel/geist-font@ef2597c](https://github.com/vercel/geist-font/blob/ef2597cfc42f4797676df105517ccc0a1cfa6569/LICENSE.txt),
OFL 1.1. Mobile uses `@expo-google-fonts/geist` 0.4.2 and `@expo-google-fonts/geist-mono` 0.4.3,
both `license: MIT AND OFL-1.1`.

**Taste Skill.** The repository `LICENSE` at
[Leonxlnx/taste-skill@f6b7657](https://github.com/Leonxlnx/taste-skill/blob/f6b76575f949707b4e3c37cd86cb44b0b98643e8/LICENSE)
is MIT, © 2026 Leonxlnx. We adopt easing values and written rules only, not code.

**Solar icons.** npm `@iconify-json/solar` 1.2.16 declares CC-BY-4.0 and the author 480 Design.
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) requires credit, a licence link and a
note of changes. Not adopted.

**Hugeicons.** npm `@hugeicons/core-free-icons` 4.4.0 and `@hugeicons/react` 1.1.10 are MIT. Pro
is covered by the [Hugeicons Pro licence](https://hugeicons.com/license-agreement) (effective
14 September 2026), which is per-seat and forbids publishing Pro source icons. Not adopted.

## Register

"Credit only" means the idea is credited here and no code or notice ships. "Planned" names the
epic expected to land the work, not a finished change.

### transitions.dev recipes (design direction 7.1)

All of these are under the Transitions.dev License. Each is written from the idea, with no
recipe code, and credited here. Planned in E02-T03 (`next/motion` presets). The notice path for
all of them is credit only. Every row also uses our colour roles instead of hard-coded colours.

| Recipe                          | Becomes               | What we change              |
| ------------------------------- | --------------------- | --------------------------- |
| Modal open/close                | dialogs               | our scrim and durations     |
| Menu dropdown, Tooltip          | `pop`                 | origin from Base UI         |
| Panel reveal, Page side-by-side | `dolly`, `sideBySide` | no blur                     |
| Toast open/close                | toasts                | no blur                     |
| Tabs sliding                    | tab indicator         | transform pill, not width   |
| Icon swap                       | `iconSwap`            | no blur                     |
| Success check, Checkbox check   | `checkDraw`           | none beyond tokens          |
| Number subtle change            | `numberChange`        | tabular figures             |
| Streaming text                  | stream tail fade      | one span per flush, no blur |
| Reasoning stream                | reasoning edge fade   | static mask only            |
| Skeleton loader and reveal      | loading states        | stepped, single breath      |
| Error state shake               | `shake`               | rejected input only         |

### React Bits references (design direction 7.2)

These are reference only and credit only, with no code from React Bits (D3).

| Item                        | Becomes                        | Where (planned)                          |
| --------------------------- | ------------------------------ | ---------------------------------------- |
| Blur Text, Split Text       | `RevealText`                   | hero, onboarding, marketing              |
| Count Up                    | `numberChange` / `NumberRoll`  | usage totals, diff stats                 |
| Light Rays, Soft Aurora     | our ambient shader (row below) | welcome, empty state, pairing, marketing |
| Spotlight Card, Glare Hover | static hover wash              | onboarding and marketing cards           |
| Stack, Swipe Toast          | toast stacking                 | toasts                                   |

### Other items

| Item                                                          | Licence                                  | Where                                           | Notice path                                                                      |
| ------------------------------------------------------------- | ---------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------- |
| Ambient light shader (5.7)                                    | ours                                     | planned E02                                     | none; first-party                                                                |
| `motion` (5.1)                                                | MIT                                      | planned E02                                     | auto manifest once it is a production dependency                                 |
| `gsap` (D1)                                                   | Webflow Standard no-charge (proprietary) | `next/motion/cinematic` (app), `apps/marketing` | see trap below                                                                   |
| Phosphor via `@phosphor-icons/core` (6.1)                     | MIT                                      | planned E03, generated into `next/icons`        | see trap below                                                                   |
| Geist, Geist Mono (4.3)                                       | OFL-1.1                                  | web, mobile, marketing                          | auto manifest (web, mobile); marketing ships `public/fonts/*-OFL.txt`            |
| Taste Skill easing and rules (7.3)                            | MIT                                      | motion tokens, review rules                     | credit only; no code                                                             |
| Marketing `nightly-sky.svg`                                   | first-party                              | download page                                   | none; hand-written gradients                                                     |
| Marketing `public/95/e6-code-concepts/*`, `src/assets/*.webp` | first-party                              | marketing pages                                 | none; brand art and app screenshots from E6 commits, no external source recorded |

Provider logos and screenshots on the marketing site are out of scope for this register.

**Phosphor trap.** The manifest generator follows production dependencies only. If
`@phosphor-icons/core` is a devDependency used only to generate components, the shipped SVGs have
no notice. The task that lands them must add a `customNotices` MIT entry for Phosphor Icons.

**`gsap` trap.** The web licence check fails on `gsap`: its tarball has no licence file and its
`license` field is a sentence linking the licence page, not an SPDX id, so `generatedNotice` has no
template to render. A `customNotices` row alone does not stop the failure. The change that makes
`gsap` a production dependency (E02-T05, or E04-T16 if that lands first) must add a
`packageOverrides` entry for `gsap` whose `noticeFile` points at a notice file the repository
writes, so the row appears in Settings > Open source licenses. `apps/marketing` has no generated
manifest; marketing use ships its notice the way the Geist fonts do.

## Decisions

The maintainer records these. An agent does not decide them.

| Decision                                                                                         | Status                                                                                         | Facts the decision rests on                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Primitive layer ([ENG-125](https://linear.app/elomigroup/issue/ENG-125))                         | Decided 2026-11-15: keep Base UI                                                               | Base UI already exposes the `--transform-origin` used by the `pop` preset.                                                                                                                    |
| D1 `gsap` ([ENG-110](https://linear.app/elomigroup/issue/ENG-110))                               | Decided 2026-11-16: `motion` plus lazy `gsap` for authored timelines; marketing may use it too | Proprietary licence. Webflow can amend it for future versions and can terminate it on non-compliance. It has no redistribution or fork clause. Brotli: `motion` 24.2 KB, `gsap` core 25.2 KB. |
| D3 React Bits ([ENG-125](https://linear.app/elomigroup/issue/ENG-125))                           | Decided 2026-11-15: reference only; reimplement from the idea, never translate its code        | Commons Clause. "Ported version" is undefined. The grant is limited to use inside an application, website or product.                                                                         |
| D4 transitions.dev Pro and Motion Agent ([ENG-125](https://linear.app/elomigroup/issue/ENG-125)) | Decided 2026-11-15: not bought                                                                 | The free set is under a custom licence, not MIT, and `pro.html` contradicts this. The company-use and Business-plan clause is stated only in `LICENSE`. "Substantial part" is undefined.      |
| Free transitions.dev recipes ([ENG-125](https://linear.app/elomigroup/issue/ENG-125))            | Decided 2026-11-15: reference only, same rule as React Bits                                    | As D4.                                                                                                                                                                                        |

When E03 replaces the icon set, `components.json` must change too: it still sets
`iconLibrary: "lucide"`.
