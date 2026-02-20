# S2026 Tracked Games Review (Senior Analyst Brief)
Date: February 20, 2026  
Scope: 3 tracked games in DB (`Week 5 Migos vs F`, `Week 5 E vs C`, `Week 6 Gargantuan vs Migos`)

## 1) Executive Summary
- The tracked sample has **1,438 shots**, **580 makes**, and **40.3% FG**.
- Shot quality clearly changes with game state:
  - FG at `61-100` cups remaining: **48.8%**
  - FG at `<=20` cups remaining: **29.3%**
- Your current cup weights are coherent and already implemented as requested:
  - `Top ISO 1.20`, `Top 1.10`, `Bottom ISO 1.05`, `Bottom 1.00`
- Current tempo signal is directionally useful but hard to interpret:
  - Average tempo multiplier on made shots: **1.155x**
  - Range: **1.00x to 1.50x**
  - In 1 of 3 games, tempo changes MVP vs base Adjusted FGM.

## 2) What The Data Says Right Now
## Overall tracked sample
- Attempts: **1,438**
- Makes: **580**
- Misses: **858**
- FG%: **40.3%**

## Make mix (share of makes)
- Bottom regular: **46.0%**
- Top regular: **40.2%**
- Bottom ISO: **7.4%**
- Top ISO: **6.4%**

Interpretation:
- Most scoring is still regular cups, not ISO.
- ISO events are high impact but low volume in this small sample.

## Game-state effect (all tracked shots)
- `61-100` cups remaining: **240 / 492** makes (**48.8% FG**)
- `41-60` cups remaining: **120 / 313** makes (**38.3% FG**)
- `21-40` cups remaining: **117 / 282** makes (**41.5% FG**)
- `<=20` cups remaining: **103 / 351** makes (**29.3% FG**)

Interpretation:
- Late-game shotmaking is materially harder.
- Any metric that rewards late makes is reasonable, but should be interpretable and stable.

## Team-level tracked snapshot
- F: **40.5% FG**, clutch FG% **35.5%** (`62` clutch attempts)
- C: **43.9% FG**, clutch FG% **34.5%** (`58` clutch attempts)
- Migos: **38.4% FG**, clutch FG% **29.7%** (`91` clutch attempts)
- Gargantuan: **41.3% FG**, clutch FG% **27.8%** (`72` clutch attempts)
- E: **39.7% FG**, clutch FG% **20.6%** (`68` clutch attempts)

## 3) Assessment Of Existing Custom Stats
## A) Adjusted FGM
Current design:
- Weighted makes only (no temporal component)
- Weights: `1.20 / 1.10 / 1.05 / 1.00`

Assessment:
- Good core stat: simple, transparent, and stable.
- Keep this as the base “skill + shot quality” volume metric.

## B) Player Rating
Current website logic now effectively uses:
- `(Adjusted FGM / game) * FG% * league avg (Adjusted FGM / game) * league avg FG%`

Assessment:
- The per-game normalization is correct and fixes aggregate inflation.
- This should remain your headline advanced rating.

## C) Tempo Rating
Current design:
- Per made shot: `base weight * (1 + alpha * (1 - remaining/100)^p)` with `alpha=0.5`, `p=2`

Assessment:
- Directionally valid: it rewards harder-to-find late makes.
- Hard for users to read quickly because it is not tied to an intuitive unit.
- It also mixes two ideas in one number: shot type value + game-state leverage.

Evidence of behavior:
- In Week 5 `E vs C`, base Adjusted FGM MVP and Tempo MVP are different.
- That confirms tempo can materially reorder players.

## 4) Recommended Additions (Concise + Interpretable)
## 1. Keep Adjusted FGM as-is (primary base stat)
No change to cup weights for now.

## 2. Add a new “Leverage Index” alongside Adjusted FGM
Suggested metric:
- `Leverage Index = mean(1 - remaining_before/100)` over made shots
- Scale to 0-100 for UI if needed.

Why:
- Easy interpretation: “how late were this player’s made cups, on average?”
- Separates *when* from *what type*.

## 3. Add “Clutch FG%” with attempt threshold
Suggested display:
- Clutch FG% at `<=20` cups remaining
- Require minimum attempts (e.g., `>=10`) to rank.

Why:
- Better than raw clutch makes for fairness and readability.

## 4. Optional replacement for current tempo leaderboard
If you want one consolidated late-value stat:
- `Late Adjusted FGM = sum(base_weight * (1 + lambda * (1 - remaining/100)))`
- Start with `lambda = 0.35` (linear) for interpretability.

Why:
- Linear leverage is easier to explain than a squared curve.
- Preserves your original intent (late makes matter more).

## 5) Data Collection Gaps To Fix Next
To empirically tune cup weights from data (instead of policy), you need one more field on every shot:
- `target_cup_type` (`top_regular`, `top_iso`, `bottom_regular`, `bottom_iso`) even on misses.

Right now, misses are not typed, so true conversion rates by intended cup type cannot be estimated.

## 6) Action Plan (Practical)
1. Keep current Adjusted FGM weights and Player Rating formula.
2. Keep clutch FG% on team hub (already changed) and add minimum-attempt qualifiers.
3. Add `Leverage Index` to player pages as an interpretable “timing value” stat.
4. Decide whether to keep tempo as secondary/internal, or replace with linear late-adjusted variant.
5. Add `target_cup_type` to shot logging so future weight tuning can be data-driven.

---
Data source generated locally: `reports/tracked-games-s2026-analysis-data.json`
