# NovaNook showcase assets

The Geofox homepage uses original NovaNook brand artwork copied unchanged and
real screenshots served from NovaNook’s existing public website. All five files
were verified against `dendy989-sudo/Booknook` at commit
`90b14dbe594268673c1a1b62f4e595e7601a57ef`.

| Asset | Original source path | Git blob SHA |
| --- | --- | --- |
| `novanook-icon.svg` | `assets/brand/novanook-icon.svg` | `ac49bc2768190fd6588db8aa8360179aa9bb24a2` |
| `novanook-wordmark-black.svg` | `assets/brand/novanook-wordmark-black.svg` | `2ec13f4de6947e78638f582437b658e94eb15960` |
| `wizard-grand-illustrated-night-fall.webp` | `assets/landing/wizard-grand-illustrated-night-fall.webp` | `981f2b714a4b2529f34d756093a0e906fc574834` |
| `grid-illustrated-day-none.webp` | `assets/landing/grid-illustrated-day-none.webp` | `e2e9bdb2aeda7007ce89d358d6eb1c7883d4bd88` |
| `belle-grand-illustrated-night-fall.webp` | `assets/landing/belle-grand-illustrated-night-fall.webp` | `6f514e828a3b72151fb12c375668687960f3babf` |

The SVGs live under `public/images/novanook/` in Geofox. The three screenshots
use `https://www.mynovanook.com/assets/landing/` with their original filenames.
Next.js optimizes those images for each display size; `next.config.ts` restricts
remote image loading to those three exact HTTPS paths. Their full-size links
open the original files. Keep these filenames available when updating NovaNook.

The room images are existing app captures referenced in NovaNook's
`welcome.html` and `landing-experience.js`. The Grid screenshot was captured
from the app's `#libraryGridShelves` by `scripts/capture-landing-grid.cjs`.
The captures use example library data; they are not customer account screenshots.
The public caption identifies them as app views with an example library.

The SVGs are the approved bookmark/star icon and original outlined wordmark.
Do not replace them with a generic book icon, substitute typeface, or generated
approximation. Preserve their aspect ratios.

Feature descriptions were checked against NovaNook's `index.html` controls and
`help-content.js`: collections and reading statuses, library views/styles,
timer and page progress, streaks and monthly stats, reward coins, companions,
outfits, reader follows and reading updates. The homepage does not advertise
store availability or imply that Pro themes are included in Free.
