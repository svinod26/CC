export const metadata = {
  title: 'Info | Century Cup'
};

export default function InfoPage() {
  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-garnet-100 bg-white/85 p-4 shadow sm:p-5">
        <p className="text-xs uppercase tracking-[0.2em] text-garnet-600">Info</p>
        <h1 className="mt-2 text-3xl font-bold text-ink">Formulas & definitions</h1>
        <p className="mt-2 text-sm text-ash">
          Quick reference for how we compute ratings, efficiencies, and team metrics.
        </p>
      </div>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-garnet-100 bg-white/85 p-4 shadow sm:p-5">
          <h2 className="text-lg font-semibold text-ink">Player ratings</h2>
          <ul className="mt-3 space-y-2 text-sm text-ash">
            <li>
              <span className="font-semibold text-ink">Adjusted FGM</span>: weighted makes.
              Weights: top {`1.10`}, bottom {`1.00`}, top ISO {`1.20`}, bottom ISO {`1.05`}.
            </li>
            <li>
              <span className="font-semibold text-ink">Player rating</span>: (Adjusted FGM / game) × FG% × league avg
              (Adjusted FGM / game) × league avg FG%.
            </li>
            <li>
              <span className="font-semibold text-ink">Rating / shot</span>: player rating ÷ total attempts.
            </li>
            <li>
              <span className="font-semibold text-ink">Tempo rating (tracked)</span>: player rating × temporal multiplier
              per make, where temporal = {`1 + alpha * (1 - remaining/100)^p`} with alpha=0.5, p=2.
            </li>
            <li>
              <span className="font-semibold text-ink">Clutch share (tracked)</span>: makes with ≤20 cups remaining ÷
              total makes.
            </li>
          </ul>
        </div>

        <div className="rounded-2xl border border-garnet-100 bg-white/85 p-4 shadow sm:p-5">
          <h2 className="text-lg font-semibold text-ink">Box score</h2>
          <ul className="mt-3 space-y-2 text-sm text-ash">
            <li>
              <span className="font-semibold text-ink">FG%</span>: makes ÷ attempts.
            </li>
            <li>
              <span className="font-semibold text-ink">Top/Bottom totals</span>: top regular + top ISO, bottom regular +
              bottom ISO.
            </li>
          </ul>
        </div>
      </section>

      <section className="rounded-2xl border border-garnet-100 bg-white/85 p-4 shadow sm:p-5">
        <h2 className="text-lg font-semibold text-ink">Team metrics</h2>
        <ul className="mt-3 space-y-2 text-sm text-ash">
          <li>
            <span className="font-semibold text-ink">Team rating</span>: sum of player ratings from all team games.
          </li>
          <li>
            <span className="font-semibold text-ink">Team tempo rating (tracked)</span>: sum of tempo ratings from all
            tracked makes.
          </li>
        </ul>
      </section>

      <section className="rounded-2xl border border-garnet-100 bg-parchment/70 p-4 text-sm text-ash sm:p-5">
        Formula sources live in <span className="font-semibold text-ink">src/lib/stats.ts</span>.
      </section>
    </div>
  );
}
