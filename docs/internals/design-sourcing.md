# Design sourcing register

The remodel borrows motion recipes, effects, icons and fonts from outside sources. Most of them
are not npm packages, so the generated [license manifest](open-source-licenses.md) cannot see
them. This page is the gate: a screen task checks it before porting a recipe, and the change that
lands borrowed work adds or updates its row here, plus a `customNotices` entry when one is owed.

This page records licence facts as read on the date given. It is not legal advice. Where a text is
ambiguous, the ambiguity is written down and left to the maintainer.

## Policy

E6 is open at the core, so anyone who forks the repository must inherit only OSI or OFL terms
on its files. That rules out committing code whose licence restricts redistribution.

- **MIT, ISC and OFL sources** may be used, copied with their notice, and listed in Settings > Open
  source licenses.
- **transitions.dev recipes are not MIT** (see below). Until D4 is decided, a recipe may only
  inform a preset written independently in our motion layer, credited here. Copying recipe code
  is not allowed: the file would carry the Transitions.dev License, not MIT.
- **Commons Clause sources (React Bits)** are reference only. Our code is written from the idea,
  never translated from their source, and is credited here. D3 may change this.
- **Proprietary no-charge sources (`gsap`)** stay out of the app. Marketing use waits for D1.
- **Paid sources** (transitions.dev Pro, React Bits Pro, Hugeicons Pro) are not used.
- **CC BY assets** (pictures, Solar icons) are marketing only, with a visible credit on the page.
- **Every sound asset needs a row here** (source, licence, changes) before it lands. The UI sound
  layer from D9 follows this rule. React Bits Sound Lab stays reference only until D3 is decided.

Check that no React Bits code has entered the repository:

```bash
git grep -n -i -E 'reactbits|react bits|react-bits|commons clause' -- . ':!.repos'
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
Webflow may amend the licence by posting new terms. If you reject them, you may not use versions
released after the change, but earlier versions keep their earlier terms. Webflow keeps all IP.
The licence incorporates Webflow's [Terms of Service](https://webflow.com/legal/terms) (effective
15 November 2023, California law), and the GSAP licence governs where the two conflict. For a fork,
this means a GSAP dependency carries terms that Webflow can change for future versions, and that
neither we nor the fork can relicense. `@gsap/react` 2.1.2 says "SEE LICENSE AT" the same page.

**React Bits.** Read at the repository's `LICENSE.md`
([DavidHDev/react-bits@cf28010](https://github.com/DavidHDev/react-bits/blob/cf2801031f07f53d4684e65b961bde7c2e2a6921/LICENSE.md)):
MIT with Commons Clause v1.0, © 2026 David Haz. Two points differ from plain MIT:

- The grant to copy, publish and distribute applies only "as part of an application, website, or
  product".
- The components may not be sold, sublicensed or redistributed "alone, in a bundle, or as a ported
  version".

The same restriction covers the tools (Sound Lab included) and the sounds library. Exports from
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
code. The terms may change with 14 days' email notice. Pro and Business are paid plans. Under the
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

All of these are under the Transitions.dev License. They are allowed only if written
independently and credited here; recipe code needs D4 and a `noticeFile` entry. Planned in E02
(`next/motion` presets). The notice path for all of them is credit only. Every row also replaces
hard-coded colours with our roles.

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

These are reference only and credit only, with no code from React Bits. D3 is open.

| Item                        | Becomes                        | Where (planned)                          |
| --------------------------- | ------------------------------ | ---------------------------------------- |
| Blur Text, Split Text       | `RevealText`                   | hero, onboarding, marketing              |
| Count Up                    | `numberChange` / `NumberRoll`  | usage totals, diff stats                 |
| Light Rays, Soft Aurora     | our ambient shader (row below) | welcome, empty state, pairing, marketing |
| Spotlight Card, Glare Hover | static hover wash              | onboarding and marketing cards           |
| Stack, Swipe Toast          | toast stacking                 | toasts                                   |

### Other items

| Item                                                          | Licence     | Where                                    | Notice path                                                                      |
| ------------------------------------------------------------- | ----------- | ---------------------------------------- | -------------------------------------------------------------------------------- |
| Ambient light shader (5.7)                                    | ours        | planned E02                              | none; first-party                                                                |
| `motion` (5.1)                                                | MIT         | planned E02                              | auto manifest once it is a production dependency                                 |
| Phosphor via `@phosphor-icons/core` (6.1)                     | MIT         | planned E03, generated into `next/icons` | see trap below                                                                   |
| Geist, Geist Mono (4.3)                                       | OFL-1.1     | web, mobile, marketing                   | auto manifest (web, mobile); marketing ships `public/fonts/*-OFL.txt`            |
| Taste Skill easing and rules (7.3)                            | MIT         | motion tokens, review rules              | credit only; no code                                                             |
| Marketing `nightly-sky.svg`                                   | first-party | download page                            | none; hand-written gradients                                                     |
| Marketing `public/95/e6-code-concepts/*`, `src/assets/*.webp` | first-party | marketing pages                          | none; brand art and app screenshots from E6 commits, no external source recorded |

Provider logos and screenshots on the marketing site are out of scope for this register.

**Phosphor trap.** The manifest generator follows production dependencies only. If
`@phosphor-icons/core` is a devDependency used only to generate components, the shipped SVGs have
no notice. The task that lands them must add a `customNotices` MIT entry for Phosphor Icons.

## Open decisions

The maintainer fills these in. They are not decided here.

| Decision                                                                        | Status                | Facts the decision rests on                                                                                                                                                                            |
| ------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1 `gsap` ([ENG-110](https://linear.app/elomigroup/issue/ENG-110))              | Waiting for the owner | Proprietary licence. Webflow can amend it for future versions and can terminate it on non-compliance. It has no redistribution or fork clause.                                                         |
| D3 React Bits ([ENG-125](https://linear.app/elomigroup/issue/ENG-125))          | Waiting for the owner | Commons Clause. "Ported version" is undefined. The grant is limited to use inside an application, website or product.                                                                                  |
| D4 transitions.dev Pro ([ENG-125](https://linear.app/elomigroup/issue/ENG-125)) | Waiting for the owner | The free set is under a custom licence, not MIT, and `pro.html` contradicts this. The extent of the company-use and Business-plan clause is stated only in `LICENSE`. "Substantial part" is undefined. |
