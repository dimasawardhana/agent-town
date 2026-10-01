# 17 — The panel says what has been built

**What to build:** The sidebar answers "what has the agent actually built here".

**Blocked by:** 16.

**Status:** done

- [x] A stage ladder reads left to right as progress
- [x] Failing, verified and just-worked counts, each in the colour the map already
      uses for that fact
- [x] Empty signals are omitted rather than shown as zeroes
- [x] The empty-state text no longer demands an environment variable the common
      case does not need

## Comments

### "14 buildings · 5 districts" was true and useless

The same fourteen buildings are a staked field or a finished town, and the
difference is exactly what a reader came for. A count of buildings cannot answer
it, so the count was decoration wearing a fact's clothes.

### One vocabulary, three places

The three signals each take the colour the map already uses: red is a failure on
the building, green is the verified pennant, and the ember's own glow is "just
worked". A reader who has learned the town does not have to learn the panel.

And the "just worked" count reuses `EMBER_MS` rather than inventing a window, so
the figure in the panel and the glow on the map are the same claim about the same
fact — two windows would be two claims, and they would eventually disagree.

### A real documentation bug, found by building the panel

The empty state told the reader to start their agent with `AI_TOWN_URL` set. That
is only true of a daemon started with `--port`; the default port is found without
it (ADR-0016). The text was wrong about the common case, and it had been sitting
in the one place a new user is guaranteed to read it.
