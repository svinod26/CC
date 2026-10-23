import './helpers/register-game-components.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { attachTurnEvents, gameViewSelect, gameTurnSelect, gameRefreshInterval, fetchGameView, GameFetchError, shouldRetryGameFetch } from '../src/lib/game-view.ts';
import { boxScore, baseRatingStats, advancedStats, winnerFromGameState } from '../src/lib/stats.ts';
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { SWRConfig } from 'swr';

const { GameDataProvider, useGameData } = await import('../src/components/game-data-provider.tsx');
const { LiveConsole } = await import('../src/components/live-console.tsx');
const { LiveBoxScores } = await import('../src/components/live-box-scores.tsx');
const { LiveScorebug } = await import('../src/components/live-scorebug.tsx');
const { LiveGameInsights } = await import('../src/components/live-game-insights.tsx');
const { GameFlowChart } = await import('../src/components/game-flow-chart.tsx');
const { act } = TestRenderer;

async function mountGame(t, initialData, children, overrides = {}) {
  let root;
  const cache = new Map();
  const config = { provider: () => cache, dedupingInterval: 0, isVisible: () => true, isOnline: () => true, ...overrides };
  await act(async () => {
    root = TestRenderer.create(React.createElement(SWRConfig, { value: config },
      React.createElement(GameDataProvider, { initialData }, children)));
  });
  t.after(async () => { await act(async () => root.unmount()); });
  return root;
}

// Apply the actual select contract to a fixture, just as the ORM projects fields.
function project(record, select) {
  if (record === null) return null;
  return Object.fromEntries(Object.entries(select).map(([key, selection]) => [key,
    selection === true ? record[key] : Array.isArray(record[key])
      ? record[key].map((value) => project(value, selection.select))
      : project(record[key], selection.select)
  ]));
}

export function fixture(status = 'IN_PROGRESS', statsSource = 'TRACKED') {
  const player = { id: 'p1', name: 'Player One', email: 'private@example.test', userId: 'private-user' };
  const events = ['TOP_REGULAR', 'MISS', 'TOP_ISO', 'BOTTOM_REGULAR', 'BOTTOM_ISO', 'PULL_HOME', 'PULL_AWAY'].map((resultType, i) => ({
    id: `e${i}`, turnId: i === 6 ? null : i < 2 ? 't1' : 't2',
    gameId: 'g1', shooterId: i >= 5 ? null : 'p1', shooter: i >= 5 ? null : player,
    resultType, cupsDelta: i === 1 ? 0 : i === 6 ? -2 : 1,
    offenseTeamId: 'home', defenseTeamId: 'away', remainingCupsBefore: 100 - i * 20,
    remainingCupsAfter: 99 - i * 20, timestamp: new Date(1000 + i), note: 'unused note'
  }));
  const raw = {
    id: 'g1', type: 'LEAGUE', status, statsSource,
    homeTeamId: 'home', awayTeamId: 'away', startedAt: new Date(0), endedAt: null,
    homeTeam: { id: 'home', name: 'Home', seasonId: 'not-needed' }, awayTeam: { id: 'away', name: 'Away' },
    state: { homeCupsRemaining: 90, awayCupsRemaining: 95, possessionTeamId: 'home', currentTurnNumber: 2,
      currentShooterIndex: 0, phase: 'REGULATION', status, updatedAt: new Date(1000) },
    scheduleEntry: { week: 1 },
    lineups: [{ id: 'l1', teamId: 'home', playerId: 'p1', orderIndex: 0, isActive: true, player }],
    events: statsSource === 'TRACKED' ? events : [],
    legacyStats: statsSource === 'LEGACY' ? [{ playerId: 'p1', teamId: 'home', player, totalCups: 12,
      topRegular: 3, topIso: 2, bottomRegular: 4, bottomIso: 3, misses: 5 }] : [],
    legacyTeamStats: [{ teamId: 'home', pulledCups: 3 }],
    statTaker: { password: 'must-never-leak' }
  };
  const turns = [{ id: 't1', offenseTeamId: 'home', turnIndex: 1, shootersJson: ['p1'] },
    { id: 't2', offenseTeamId: 'home', turnIndex: 2, shootersJson: ['p1'] }];
  const selected = project(raw, gameViewSelect);
  return { raw, turns, view: { ...selected, turns: attachTurnEvents(turns.slice(-1), selected.events) } };
}

test('selected data preserves box scores, base ratings and tempo ratings exactly', () => {
  const { raw, view } = fixture();
  for (const calculate of [boxScore, baseRatingStats, advancedStats]) {
    assert.deepEqual(calculate(view.events), calculate(raw.events));
  }
  assert.equal(boxScore(view.events).get('p1').attempts, 5);
  assert.equal(boxScore(view.events).get('p1').makes, 4);
  assert.equal(baseRatingStats(view.events).get('p1').weightedPoints, 4.35);
  assert.equal(view.state.updatedAt.getTime(), 1000);
  assert.equal(JSON.stringify(view).includes('private@example.test'), false);
  assert.equal(JSON.stringify(view).includes('must-never-leak'), false);
  assert.ok(JSON.stringify(view.events).length < JSON.stringify(raw.events).length);
});

test('turn grouping preserves order, empty turns and null-turn history without mutation', () => {
  const { turns, view } = fixture();
  const original = structuredClone(view.events);
  const grouped = attachTurnEvents([...turns, { id: 'empty' }], view.events);
  assert.deepEqual(grouped.map((turn) => turn.events.map((event) => event.id)), [['e0', 'e1'], ['e2', 'e3', 'e4', 'e5'], []]);
  assert.equal(view.events.at(-1).turnId, null);
  assert.deepEqual(view.events, original);
  assert.equal('events' in turns[0], false);
  assert.equal('events' in gameTurnSelect, false);
  assert.deepEqual(gameViewSelect.events.orderBy, [{ timestamp: 'asc' }, { id: 'asc' }]);
});

test('legacy totals and winner semantics survive selection, including overtime tied at zero', () => {
  const { raw, view } = fixture('FINAL', 'LEGACY');
  assert.deepEqual(view.legacyStats[0], { ...raw.legacyStats[0], player: { id: 'p1', name: 'Player One' } });
  assert.equal(winnerFromGameState(view.state, view), 'home');
  assert.equal(winnerFromGameState({ ...view.state, phase: 'OVERTIME', homeCupsRemaining: 0, awayCupsRemaining: 0 }, { ...view, statsSource: 'TRACKED' }), 'home');
});

test('poll policy uses current status and never polls final, legacy or missing snapshots', () => {
  assert.equal(gameRefreshInterval(fixture().view), 3000);
  assert.equal(gameRefreshInterval(fixture('FINAL').view), 0);
  assert.equal(gameRefreshInterval(fixture('FINAL', 'LEGACY').view), 0);
  assert.equal(gameRefreshInterval(null), 0);
  assert.equal(gameRefreshInterval(undefined), 0);
});

test('fetch handles deletion and terminal authorization errors without retrying them', async (t) => {
  for (const status of [200, 401, 403, 404, 500]) {
    t.mock.method(globalThis, 'fetch', async (_url, options) => {
      assert.equal(options.cache, 'no-store');
      return new Response(JSON.stringify({ status }), { status });
    });
    if (status === 200) assert.deepEqual(await fetchGameView('/test'), { status });
    else if (status === 404) assert.equal(await fetchGameView('/test'), null);
    else await assert.rejects(fetchGameView('/test'), (error) => error instanceof GameFetchError && error.status === status);
    assert.equal(shouldRetryGameFetch(new GameFetchError(status)), ![401, 403, 404].includes(status));
    t.mock.restoreAll();
  }
});

test('state query and initial page share the narrow projection and do not query nested turn events', async () => {
  for (const file of ['../src/app/api/games/[id]/state/route.ts', '../src/app/(app)/games/[id]/page.tsx']) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /\.\.\.gameViewSelect/);
    assert.match(source, /attachTurnEvents\(/);
    assert.doesNotMatch(source, /include:\s*\{/);
  }
  for (const name of ['live-console', 'live-scorebug', 'live-box-scores', 'live-game-insights', 'game-flow-chart']) {
    const source = await readFile(new URL(`../src/components/${name}.tsx`, import.meta.url), 'utf8');
    assert.match(source, /useGameData\(/);
    assert.doesNotMatch(source, /useSWR|refreshInterval/);
  }
});

test('real provider: five consumers share one initial request and one 3-second poll, then stop on FINAL', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  let current = fixture().view;
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json(current); });
  const seen = new Map();
  function Consumer({ index }) { const { data } = useGameData(); seen.set(index, data); return null; }
  await mountGame(t, current, Array.from({ length: 5 }, (_, index) => React.createElement(Consumer, { key: index, index })));
  assert.equal(calls, 1);
  await act(async () => { t.mock.timers.tick(2999); });
  assert.equal(calls, 1);
  await act(async () => { t.mock.timers.tick(1); });
  assert.equal(calls, 2);
  current = { ...current, status: 'FINAL', state: { ...current.state, status: 'FINAL' } };
  await act(async () => { t.mock.timers.tick(3000); });
  assert.equal(calls, 3);
  for (const snapshot of seen.values()) assert.equal(snapshot.status, 'FINAL');
  assert.equal(new Set(seen.values()).size, 1);
  await act(async () => { t.mock.timers.tick(30000); });
  assert.equal(calls, 3);
});

test('real provider: final games do not poll, but manual revalidation retrieves corrections', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  let current = fixture('FINAL', 'LEGACY').view;
  let calls = 0;
  let context;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json(current); });
  function Consumer() { context = useGameData(); return null; }
  await mountGame(t, current, React.createElement(Consumer));
  assert.equal(calls, 1);
  await act(async () => { t.mock.timers.tick(30000); });
  assert.equal(calls, 1);
  current = { ...current, legacyStats: [{ ...current.legacyStats[0], totalCups: 20 }] };
  await act(async () => { await context.mutate(); });
  assert.equal(calls, 2);
  assert.equal(context.data.legacyStats[0].totalCups, 20);
});

test('real scorer: shot and undo force immediate shared refresh without advancing the polling clock', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  let current = fixture().view;
  let reads = 0;
  const writes = [];
  globalThis.__gameTestRouter = { replace() {}, refresh() {} };
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    if (options.method === 'POST') {
      writes.push({ url, body: options.body && JSON.parse(options.body) });
      current = { ...current, state: { ...current.state, currentShooterIndex: 1 } };
      return Response.json({ ok: true });
    }
    reads++;
    return Response.json(current);
  });
  const root = await mountGame(t, current, React.createElement(LiveConsole, { gameId: 'g1', isScorer: true }));
  const button = (label) => root.root.findAllByType('button').find((node) => node.props.children === label);
  assert.equal(reads, 1);
  await act(async () => { await button('Top').props.onClick(); });
  assert.equal(reads, 2);
  assert.equal(writes[0].body.resultType, 'TOP_REGULAR');
  assert.equal(writes[0].body.shooterId, 'p1');
  await act(async () => { await button('Undo').props.onClick(); });
  assert.equal(reads, 3);
  assert.equal(writes[1].url, '/api/games/g1/undo');
});

test('real scorer: failed action shows error without refetching or changing the snapshot', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const current = fixture().view;
  let reads = 0;
  globalThis.__gameTestRouter = { replace() {}, refresh() {} };
  t.mock.method(globalThis, 'fetch', async (_url, options = {}) => {
    if (options.method === 'POST') return Response.json({ error: 'Another score update landed first.' }, { status: 409 });
    reads++; return Response.json(current);
  });
  const root = await mountGame(t, current, React.createElement(LiveConsole, { gameId: 'g1', isScorer: true }));
  await act(async () => { await root.root.findAllByType('button').find((node) => node.props.children === 'Top').props.onClick(); });
  assert.equal(reads, 1);
  assert.match(JSON.stringify(root.toJSON()), /Another score update landed first/);
});

test('display components render identically from full records and the selected payload', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  // Hold the automatic mount fetch so this compares server fallback rendering.
  t.mock.method(globalThis, 'fetch', () => new Promise(() => {}));
  for (const source of ['TRACKED', 'LEGACY']) {
    const { raw, turns, view } = fixture('FINAL', source);
    const children = React.createElement(React.Fragment, null,
      React.createElement(LiveBoxScores), React.createElement(LiveScorebug), React.createElement(LiveGameInsights),
      React.createElement(GameFlowChart, { homeTeamId: 'home', awayTeamId: 'away', homeTeamName: 'Home', awayTeamName: 'Away' }));
    const full = await mountGame(t, { ...raw, turns: attachTurnEvents(turns.slice(-1), raw.events) }, children);
    const narrow = await mountGame(t, view, children);
    assert.deepEqual(narrow.toJSON(), full.toJSON());
  }
});

test('real provider: hidden/offline views skip polls and resume when active', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  let visible = true;
  let online = true;
  let calls = 0;
  const current = fixture().view;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json(current); });
  await mountGame(t, current, null, { isVisible: () => visible, isOnline: () => online });
  assert.equal(calls, 1);
  visible = false;
  await act(async () => { t.mock.timers.tick(9000); });
  assert.equal(calls, 1);
  visible = true;
  online = false;
  await act(async () => { t.mock.timers.tick(9000); });
  assert.equal(calls, 1);
  online = true;
  await act(async () => { t.mock.timers.tick(3000); });
  assert.equal(calls, 2);
});

test('real provider: terminal errors/deletion stop recurring requests', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  for (const status of [401, 403, 404]) {
    let calls = 0;
    let context;
    t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({}, { status }); });
    function Consumer() { context = useGameData(); return null; }
    const root = await mountGame(t, fixture().view, React.createElement(Consumer));
    await act(async () => { t.mock.timers.tick(30000); });
    assert.equal(calls, 1);
    if (status === 404) assert.equal(context.data, null);
    await act(async () => root.unmount());
  }
});

test('real provider: stale in-flight poll cannot overwrite an immediate post-action refresh', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const current = fixture().view;
  let calls = 0;
  let context;
  let resolveStale;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    if (calls === 2) return new Promise((resolve) => { resolveStale = resolve; });
    return Response.json(calls === 3 ? { ...current, events: [] } : current);
  });
  function Consumer() { context = useGameData(); return null; }
  await mountGame(t, current, React.createElement(Consumer));
  await act(async () => { t.mock.timers.tick(3000); });
  assert.equal(calls, 2);
  await act(async () => { await context.mutate(); });
  assert.equal(calls, 3);
  assert.deepEqual(context.data.events, []);
  await act(async () => { resolveStale(Response.json(current)); });
  assert.deepEqual(context.data.events, []);
});

test('real scorer: adding cups preserves negative adjustment and immediate refresh', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const current = fixture().view;
  let reads = 0;
  let posted;
  globalThis.__gameTestRouter = { replace() {}, refresh() {} };
  t.mock.method(globalThis, 'fetch', async (_url, options = {}) => {
    if (options.method === 'POST') { posted = JSON.parse(options.body); return Response.json({ ok: true }); }
    reads++; return Response.json(current);
  });
  const root = await mountGame(t, current, React.createElement(LiveConsole, { gameId: 'g1', isScorer: true }));
  const button = (label) => root.root.findAllByType('button').find((node) => [node.props.children].flat().join('') === label);
  await act(async () => button('Show options').props.onClick());
  await act(async () => button('Add Home side').props.onClick());
  await act(async () => { await button('Confirm').props.onClick(); });
  assert.deepEqual(posted, { resultType: 'PULL_HOME', teamId: 'home', count: -1 });
  assert.equal(reads, 2);
});

test('real scorer: overtime winner is invalidated by updatedAt, finalization refreshes and redirects', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const base = fixture().view;
  let current = { ...base, state: { ...base.state, phase: 'OVERTIME', homeCupsRemaining: 0, awayCupsRemaining: 0 } };
  let reads = 0;
  let posted;
  const redirects = [];
  globalThis.__gameTestRouter = { replace(path) { redirects.push(path); }, refresh() {} };
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    if (options.method === 'POST') {
      assert.equal(url, '/api/games/g1/finalize');
      posted = JSON.parse(options.body);
      current = { ...current, status: 'FINAL', state: { ...current.state, status: 'FINAL', possessionTeamId: 'home' } };
      return Response.json({ ok: true });
    }
    reads++; return Response.json(current);
  });
  const root = await mountGame(t, current, React.createElement(LiveConsole, { gameId: 'g1', isScorer: true }));
  const button = (label) => root.root.findAllByType('button').find((node) => [node.props.children].flat().join('') === label);
  const confirm = () => button('Confirm OT winner and end game');
  assert.equal(confirm().props.disabled, true);
  await act(async () => button('Home won OT').props.onClick());
  assert.equal(confirm().props.disabled, false);
  current = { ...current, state: { ...current.state, updatedAt: new Date(2000) } };
  await act(async () => { t.mock.timers.tick(3000); });
  assert.equal(confirm().props.disabled, true);
  await act(async () => button('Home won OT').props.onClick());
  await act(async () => { await confirm().props.onClick(); });
  assert.deepEqual(posted, { winnerTeamId: 'home' });
  assert.deepEqual(redirects, ['/']);
  assert.equal(reads, 3);
  assert.equal(root.toJSON(), null);
  await act(async () => { t.mock.timers.tick(30000); });
  assert.equal(reads, 3);
});

test('console preserves bonus shooter selection, redemption, inactive lineups and view-only permissions', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  t.mock.method(globalThis, 'fetch', () => new Promise(() => {}));
  globalThis.__gameTestRouter = { replace() {}, refresh() {} };
  for (const phase of ['REGULATION', 'REDEMPTION']) {
    const { raw, turns } = fixture();
    raw.state.phase = phase;
    raw.lineups.push({ id: 'l2', teamId: 'home', playerId: 'p2', orderIndex: 1, isActive: true,
      player: { id: 'p2', name: 'Bonus Shooter', email: 'hidden@example.test' } });
    raw.lineups.push({ id: 'l3', teamId: 'home', playerId: 'p3', orderIndex: 2, isActive: false,
      player: { id: 'p3', name: 'Inactive Shooter' } });
    turns[1].shootersJson = ['p2', 'p3'];
    const selected = project(raw, gameViewSelect);
    const full = { ...raw, turns: attachTurnEvents(turns.slice(-1), raw.events) };
    const narrow = { ...selected, turns: attachTurnEvents(turns.slice(-1), selected.events) };
    const children = React.createElement(LiveConsole, { gameId: 'g1', isScorer: false });
    const before = await mountGame(t, full, children);
    const after = await mountGame(t, narrow, children);
    assert.deepEqual(after.toJSON(), before.toJSON());
    assert.match(JSON.stringify(after.toJSON()), /Bonus Shooter/);
    assert.doesNotMatch(JSON.stringify(after.toJSON()), /Inactive Shooter/);
    assert.equal(after.root.findAllByType('button').length, 0);
  }
});

test('empty games and unknown shooters retain the same rendered display after field selection', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  t.mock.method(globalThis, 'fetch', () => new Promise(() => {}));
  for (const empty of [true, false]) {
    const { raw } = fixture('FINAL');
    raw.state = null;
    raw.lineups = [];
    raw.events = empty ? [] : [{ ...raw.events[0], shooterId: null, shooter: null }];
    const selected = project(raw, gameViewSelect);
    const children = React.createElement(React.Fragment, null,
      React.createElement(LiveBoxScores), React.createElement(LiveScorebug), React.createElement(LiveGameInsights));
    const before = await mountGame(t, { ...raw, turns: [] }, children);
    const after = await mountGame(t, { ...selected, turns: [] }, children);
    assert.deepEqual(after.toJSON(), before.toJSON());
  }
});
