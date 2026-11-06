# Shipstake

Teams lock SOL behind a public promise to ship something by a date. If they ship on time, they get it back. If they miss, the stake goes to their backers.

**Status: not on mainnet, and not audited. Don't use real funds.**

## Rules

| Stage | What happens |
| --- | --- |
| Create | The team publishes the promise, what counts as proof, the deadline and a reviewer wallet, then locks the stake. None of this can be edited. |
| Back | Anyone except the team and reviewer deposits SOL. Backing closes halfway to the deadline. Deposits are always returned, after settlement. |
| Proof | The team posts proof once, by the deadline. No proof means a miss. |
| Challenge | Any backer can challenge within 72 hours. An unchallenged proof counts as shipped. |
| Review | After a challenge, the reviewer has 7 days to rule. If they don't, it counts as a miss, because the team chose them. |
| Settle | Anyone can settle a promise once its timer ends. |
| Payout | Shipped: the team withdraws the stake. Missed: backers split it by amount backed. Missed with no backers: the team gets it back. |

Limits: minimum stake 0.01 SOL, minimum backing 0.001 SOL, deadline 24 hours to 366 days out.

## Layout

- `programs/shipstake` — the Anchor escrow program
- `tests` — program tests on LiteSVM
- `scripts/flow.ts` — every path against a live node with real timers
- `app` — landing page (`index.html`) and app (`app.html`)
- `server/waitlist.mjs` — saves waitlist emails to `data/waitlist.csv`

## Run it

Requires Rust, the Solana CLI and Anchor.

```bash
npm install && (cd app && npm install)
anchor build && npm test
```

Local version, with a burner wallet and 2-minute timers:

```bash
anchor build -- --features devnet-fast
cp target/deploy/shipstake.so target/deploy/shipstake-fast.so
solana-test-validator --reset --bpf-program "$(solana-keygen pubkey target/deploy/shipstake-keypair.json)" target/deploy/shipstake-fast.so
node server/waitlist.mjs
cd app && npx vite --mode localnet
```

Run `anchor build` again afterwards, because the `devnet-fast` timers must never reach mainnet.

## Before mainnet

- Replace the placeholders in `security_txt!` in `programs/shipstake/src/lib.rs` with your real site, security contact and policy.
- Get an independent audit, then set `VITE_AUDIT_URL`.
- Publish the repo, set `VITE_REPO_URL`, and run `solana-verify` so the on-chain program can be matched to the source.
- Move the upgrade key to a public multisig. Remove it completely once you're confident the code won't need fixes.
- Set `VITE_SITE_URL` to your official domain, and register that domain with the major wallets.

The Verify page in the app reads the upgrade key live and shows these links only once they're set.

## Deploy to devnet

Send about 2.5 devnet SOL to the wallet in `.keys/devnet-deployer.json`, then:

```bash
npm run deploy:devnet
```

`.keys` and `target/deploy/shipstake-keypair.json` control the program's upgrades and aren't in git. Back them up. `.keys/shipstake-program-keypair.json` is a copy of the program key.
