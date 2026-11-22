# Launch Radar

An entry for make.fun's **token-radar-01** bounty: a token launch radar that reads a sealed
snapshot of the protocol universe (DefiLlama data, 758 protocols) and ranks every protocol
that records no token by what its token would be worth at the multiples comparable live
tokens already carry — with a concrete farm plan for each row.

## The model

`implied = TVL x category multiple x momentum x maturity x reach`, capped at the largest
live market cap in the snapshot.

- **Category multiple** — the median market-cap/TVL of the snapshot's live-token protocols
  in the same category, shrunk toward the snapshot-wide median by sample size.
- **Momentum** — the week's TVL change, clamped to [-50%, +100%], at half weight.
- **Maturity** — the length of the protocol's record: 0.55 on day one, 1.00 at two years.
- **Reach** — +3% per chain past the first, up to seven.

No protocol name is special-cased; the same function values every row, and the dashboard
recomputes each row on the page so the board and the page visibly agree.

## Layout

- `main.ts` — the program: snapshot in, `board.json` + `data.js` + dashboard + dossier out.
- `lib/model.ts` — the value model, the board builder and the farm-plan generator.
- `dashboard/` — a static page (board, filters, per-protocol detail, live comparison set).
- `screenshots/` — the board, a detail view and a filtered view, rendered from this page.
- `vendor/makefun-board.ts` — make.fun's dossier library, vendored byte for byte.

## Run

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

Node 22.18+, standard library only, no network.
