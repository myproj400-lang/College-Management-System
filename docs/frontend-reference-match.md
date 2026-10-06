# Frontend reference update

The supplied ICMS images guide the existing React frontend. The update uses a 273 px green sidebar, a 71 px toolbar, a mint workspace, white cards, green actions, gold accents, and responsive layouts. Typography uses a consistent Segoe UI/system sans-serif stack, smaller headings, and compact form controls. The sign-in photo, class illustrations, books, and campus linework are extracted from the supplied references; the application UI remains HTML, CSS, and React.

Updated views: sign-in and applicant account creation; administrator, lecturer, and student dashboards; applications and applicant tracking; users; registration; gradebook; student results and term publication; student record. Shared styles also apply to the remaining existing directories and forms.

The current API supports term publication rather than course batch approval, student class attendance rather than lecturer campus attendance/corrections, and has no assignment submission, grading rubric, or course materials service. Those additional reference workflows have not been added. Monthly admissions reporting remains an explicitly empty chart, and administrative application totals remain unavailable because the API restricts admissions records to the relevant roles. The gradebook retains the API's marks out of 100 and course weighting rules.

## Validation

- `cd web; npm run build` passes TypeScript checking and the production build.
- `cd server; npm run typecheck` passes backend TypeScript checking.
- Updated typography checks at 1536 px and 390 px confirm no horizontal overflow on sign-in. Hero headings are 52 px and 38 px respectively; mobile inputs remain 16 px. The `typography-login-*.png` screenshots show this latest styling.
- Chrome checks render ten supported views at 1536 × 1024 without JavaScript exceptions.
- Registration, overview, student dashboard, and sign-in render at 390 × 844 without page overflow. Wide tables scroll within their cards.
- Browser interactions verify password visibility, applicant form opening, registration selection/credit totals, removal of a selected course, and the account menu.

The PNG files in `frontend-previews/` use intercepted API fixtures solely to inspect populated layouts. They are not production records, seed data, or a claim of an exact pixel comparison. `check.cjs` and `interactions.cjs` only intercept requests in a headless browser; they do not write to the backend.

To repeat the browser checks, build the app, run `npm run preview -- --host 127.0.0.1 --port 4173`, launch headless Chrome with a temporary user data directory and `--remote-debugging-port=9222`, then run the `.cjs` scripts from the repository root. This environment used `--configLoader native` for Vite preview because its sandbox blocks Vite's default configuration subprocess.
