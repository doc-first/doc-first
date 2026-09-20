## What changes, and why it was needed

<!-- The why matters more. If there was an accident behind this, describe it — that is what stops
     someone from undoing the fix later. -->

## Proof

- [ ] `npm test` green
- [ ] `npx tsc --noEmit` clean
- [ ] `bash review/test-contract.sh` green
- [ ] `npx eslint review` clean

**If this touches a lock** — the fingerprint, the traffic light, approval validity, the triggers:

- [ ] I broke my own test on purpose and watched it fail

Say what you broke and what the failure looked like. A green test nobody has seen fail proves
nothing.

## What this does not cover

<!-- Every change has an edge it does not handle. Naming it here is worth more than pretending
     there is none. -->
