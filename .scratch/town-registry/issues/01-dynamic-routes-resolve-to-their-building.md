# 01 — Dynamic routes resolve to their building

**What to build:** A file inside a directory whose name contains brackets — a Next.js dynamic route such as `[slug]`, `[id]` or `[...catchAll]` — resolves to its building rather than to the Yard. Today an agent editing such a file renders as standing in the Yard doing site-wide work, which is wrong about where it is working.

Path Resolution treats any path containing `[`, `*` or `?` as a glob pattern naming a set of files rather than a place. That is right for a genuine glob (`src/**/*.ts`) and wrong for a directory that merely has brackets in its name.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] A file under a bracketed directory resolves to that directory's building, with a reason of `building`
- [x] A genuine glob pattern still resolves to the Yard with reason `glob`, so the fix does not trade one wrong answer for another
- [x] A file outside any building still resolves to the Yard as `unmapped`, unchanged
- [x] Verified against a real repository containing at least one dynamic route, not only a synthetic fixture
