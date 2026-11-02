# Cloud Functions — server-side enforcement of the money path

Optional. **Nothing in this folder runs unless it is deployed**, and the app does not change
behaviour when it is absent: each till probes the callables on first use and falls back to
the local path when they are not there. This is why `firebase.json` in the project root has no
`functions` block yet — adding it is a deliberate step.

## What is enforced and what is only detected

| Rule | Where | Effect |
| --- | --- | --- |
| Approval PIN is checked against the stored verifier | `verifyApprovalPin` (callable) | Refuses a wrong PIN, and upgrades a legacy SHA-256 verifier on the spot |
| Too many wrong PINs from one user | `verifyApprovalPin` | `resource-exhausted` after 8 attempts in 5 minutes (per instance) |
| One seal per day, no future seal, no seal older than 400 days | `sealEndOfDay` (callable) | Refuses; two tills closing the same day serialize on a lock document |
| A seal that does not add up against itself | `sealEndOfDay` | Refuses with the list of inconsistent fields |
| Stock never goes negative | `guardInventory` (trigger) | Recorded in `moneyPathViolations` |
| Two products do not share a SKU | `guardInventory` | Recorded |
| Two customers do not share a phone | `guardCustomer` | Recorded |
| A debt does not push a customer past their credit limit | `guardCustomerDebt` | Recorded |
| Money is not booked onto a day that is already sealed | `guardSale`, `guardRepair`, `guardCustomerDebt` | Recorded |
| Approvals are resolved by an admin, and not by the requester | `guardApprovalRequest` | Recorded |

A background trigger cannot reject the write it was notified about — by the time it runs, the
document is committed and other devices already read it. So the guards **detect**, never
repair, and never write back into the collection they watch. Enforcement means the refusal in
a callable, which the till asks for.

Guards fire only on a change that can actually move a closed day's numbers (a status, a
payment, a price). A guard that flagged every edit of an old repair ticket would produce
hundreds of rows a day, and a log that full gets ignored.

Deliberately **not** here: the day's arithmetic. That formula lives in
`src/utils/dayFigures.ts` and the seal and the reports both read it. A second copy in
`functions/lib` would drift from the first, which is the exact bug the unified formula closed.
`sealSelfCheck` only asks whether a seal agrees with its own bookkeeping.

## Deploying

1. Add the functions block to `firebase.json` (the root file currently has `firestore` and
   `hosting` only):

   ```json
   "functions": {
     "source": "functions",
     "codebase": "default",
     "ignore": ["node_modules", ".git", "*.local"]
   },
   ```

2. `npm --prefix functions install` (already done in this checkout; `functions/node_modules`
   is gitignored).
3. Check the two constants at the top of `functions/index.js` for this shop: `REGION`
   (`us-central1`) and `SHOP_TIME_ZONE` (`Africa/Algiers`, overridable with the
   `SHOP_TIME_ZONE` environment variable). The time zone decides which calendar day a
   timestamp belongs to — if it disagrees with the till's own zone, a legitimate closing can
   be refused as "future", and a guard can name the wrong day.
4. `npm run deploy --prefix functions` — or `firebase deploy --only functions`. On the first
   deploy, accept the Cloud Build / Artifact Registry enablement prompts.
5. Read the log: `firebase functions:log` and the `moneyPathViolations` collection
   (admins can read it, nobody can write it — see `firestore.rules`).

Roll out in this order, so a false positive is a log line rather than a blocked sale:
deploy the guards first and watch `moneyPathViolations` for a week, then confirm
`sealEndOfDay` refuses nothing it should accept.

## Local run

`npm test` runs the invariant library with plain `node --test` (no emulator, no credentials):

```
npm --prefix functions test
npm --prefix functions run check   # node --check on the entrypoints
```

The Firebase emulator (`npm run serve`) needs the Firestore emulator, which needs a **JRE** —
this project's machine has none, so the emulator has never been started here and the guards
have not been exercised end to end. `changedMoneyFields`, the seal transaction and the rate
limiter are the parts a `firebase emulators:start` run would be the first to prove.

## What the till does with it

`src/services/serverEnforcement.ts` is the client half. It loads `firebase/functions` lazily,
answers `ok` / `rejected` / `unavailable`, and stops asking for the rest of the session once
the deploy is known to be missing.

- `approvalStore.verifyPin` — the server's answer is taken. A `rejected` is **not** traded for
  a local `yes`; only a missing server falls back.
- `endOfDayStore.closeDay` — asks the server to write the seal and adopts the row it wrote.
  A refusal still closes the day locally (a shop must be able to close), but logs a warning,
  because a rejected seal is a seal the next report will disagree with.
