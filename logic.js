// logic.js
// 점수 계산 규칙과 계획서 내용(일정, 조편성, 배점표, 선언문)을 모아 둔 파일입니다.
// 화면이나 Firebase와 상관없이 "계산만" 하기 때문에, 배점이 바뀌면 이 파일만 고치면 됩니다.

// ───────── 학교 규모 ─────────
export const GRADES = [1, 2, 3];
export const CLASS_COUNT = { 1: 12, 2: 10, 3: 12 };

export const key = (g, c) => `${g}_${c}`; // 저장용 이름 (예: 1학년 3반 → "1_3")
export const label = (g, c) => `${g}-${c}`; // 화면 표시용 (예: "1-3")
export const classes = (g) => Array.from({ length: CLASS_COUNT[g] }, (_, i) => i + 1);

// ───────── 학년별 조 편성 ─────────
export const GROUPS = {
  1: [[1, 2, 3, 4, 5, 6], [7, 8, 9, 10, 11, 12]],
  2: [[1, 2, 3, 4, 5], [6, 7, 8, 9, 10]],
  3: [[1, 2, 3, 4, 5, 6], [7, 8, 9, 10, 11, 12]],
};
export const ADVANCE_PER_GROUP = 3; // 조별 3개 반이 결승 진출 (총 6개 반)

// ───────── 종목과 배점표 ─────────
// points 배열은 [1위, 2위, 3위, 4위, 5위 이하] 순서입니다.
export const EVENTS = [
  { id: 'march', name: '반별 행진', head: ['반별', '행진'], type: 'rank', points: [50, 40, 30, 20, 10] },
  { id: 'marathon', name: '8자 마라톤', head: ['8자', '마라톤'], type: 'count', points: [150, 120, 100, 80, 50] },
  { id: 'typhoon', name: '태풍 파도타기', head: ['태풍', '파도타기'], type: 'league', points: [150, 120, 100, 80, 50] },
  // 줄다리기: 1위 150, 2위 120, 공동 3위(4강 진출) 100, 5위 이하 50 (4위는 없음)
  { id: 'tug', name: '줄다리기', head: ['줄다', '리기'], type: 'tug', points: [150, 120, 100, null, 50] },
  { id: 'relay', name: '이어달리기', head: ['이어', '달리기'], type: 'league', points: [130, 110, 90, 70, 50] },
];

// 종합 점수가 같을 때: 태풍 파도타기 → 줄다리기 → 8자 마라톤 점수가 높은 반이 앞섭니다.
export const TIE_BREAK = ['typhoon', 'tug', 'marathon'];

export const CULTURE = [
  { id: 'sp', name: '스포츠맨십', sub: '', max: 40 },
  { id: 'cheer', name: '응원', sub: '준비물(깃발 포함) & 창의성 & 열정', max: 30 },
  { id: 'tidy', name: '정리 정돈', sub: '질서 & 청결', max: 30 },
];

const OUT = 99; // "예선 탈락"을 나타내는 내부 값 (5위 이하와 같은 점수)

export function pointsFor(ev, rank) {
  if (rank === null || rank === undefined) return null;
  const idx = Math.min(rank, 5) - 1;
  const p = ev.points[idx];
  return p === undefined ? null : p;
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// 높은 값이 1위. 같은 값은 공동 순위(1, 1, 3 …)
function competitionRanks(items) {
  const sorted = [...items].sort((a, b) => b.v - a.v);
  const out = {};
  let prev = null;
  let rank = 0;
  sorted.forEach((it, i) => {
    if (prev === null || it.v !== prev) {
      rank = i + 1;
      prev = it.v;
    }
    out[it.id] = rank;
  });
  return out;
}

// ───────── 종목별 계산 ─────────
// 반환: { byClass: {반번호: {rank, points, text, ...}}, complete, started, ...종목별 추가 정보 }

function computeRankEvent(state, ev, g) {
  const m = state.march || {};
  const byClass = {};
  let count = 0;
  for (const c of classes(g)) {
    const r = num(m[key(g, c)]);
    if (r !== null) count++;
    byClass[c] = { rank: r, points: pointsFor(ev, r), text: r === null ? '-' : r >= 5 ? '5위 이하' : `${r}위` };
  }
  return { byClass, complete: count === CLASS_COUNT[g], started: count > 0 };
}

function computeCountEvent(state, ev, g) {
  const rec = state.marathon || {};
  const list = classes(g).map((c) => {
    const r = rec[key(g, c)] || {};
    const a = num(r.a);
    const b = num(r.b);
    const done = a !== null && b !== null;
    const any = a !== null || b !== null;
    return { c, a, b, done, total: any ? (a || 0) + (b || 0) : null };
  });
  const ranks = competitionRanks(list.filter((x) => x.done).map((x) => ({ id: x.c, v: x.total })));
  const byClass = {};
  for (const x of list) {
    const rank = x.done ? ranks[x.c] : null;
    byClass[x.c] = {
      rank,
      points: pointsFor(ev, rank),
      a: x.a,
      b: x.b,
      total: x.total,
      done: x.done,
      text: rank === null ? (x.total === null ? '-' : '집계중') : `${rank}위`,
    };
  }
  const doneCount = list.filter((x) => x.done).length;
  return {
    byClass,
    complete: doneCount === CLASS_COUNT[g],
    started: list.some((x) => x.a !== null || x.b !== null),
  };
}

function computeLeagueEvent(state, ev, g) {
  const s = state[ev.id] || {};
  const adv = s.adv || {};
  const fin = s.final || {};
  const groups = GROUPS[g].map((members, i) => {
    const advanced = members.filter((c) => adv[key(g, c)] === true);
    return { no: i + 1, members, advanced, done: advanced.length >= ADVANCE_PER_GROUP };
  });
  const finalists = groups.flatMap((gr) => gr.advanced);
  const byClass = {};
  for (const gr of groups) {
    for (const c of gr.members) {
      if (gr.advanced.includes(c)) {
        const r = num(fin[key(g, c)]);
        byClass[c] = { stage: 'final', rank: r, points: pointsFor(ev, r), text: r === null ? '결승 대기' : `${r}위` };
      } else if (gr.done) {
        byClass[c] = { stage: 'out', rank: OUT, points: pointsFor(ev, OUT), text: '예선 탈락' };
      } else {
        byClass[c] = { stage: 'wait', rank: null, points: null, text: '예선 대기' };
      }
    }
  }
  const complete =
    groups.every((gr) => gr.done) && finalists.every((c) => num(fin[key(g, c)]) !== null);
  const started = finalists.length > 0;
  return { byClass, complete, started, groups, finalists };
}

function computeTugEvent(state, ev, g) {
  const t = (state.tug || {})[g] || {};
  const semis = [0, 1, 2, 3].map((i) => num(t['s' + i]));
  const pick = (w, a, b) => (w !== null && a !== null && b !== null && (w === a || w === b) ? w : null);
  const w1 = pick(num(t.w1), semis[0], semis[1]);
  const w2 = pick(num(t.w2), semis[2], semis[3]);
  const wf = pick(num(t.wf), w1, w2);
  const semiReady = semis.every((c) => c !== null) && new Set(semis).size === 4;
  const byClass = {};
  for (const c of classes(g)) {
    let rank = null;
    let text = '-';
    const idx = semis.indexOf(c);
    if (idx >= 0) {
      const w = idx < 2 ? w1 : w2;
      if (wf !== null) {
        if (c === wf) { rank = 1; text = '우승'; }
        else if (c === (wf === w1 ? w2 : w1)) { rank = 2; text = '준우승'; }
        else { rank = 3; text = '공동 3위'; }
      } else if (w !== null) {
        if (c === w) text = '결승 진출';
        else { rank = 3; text = '공동 3위'; }
      } else {
        text = '4강 진출';
      }
    } else if (semiReady) {
      rank = 5;
      text = '5위 이하';
    }
    byClass[c] = { rank, points: pointsFor(ev, rank), text };
  }
  return {
    byClass,
    complete: wf !== null,
    started: semis.some((c) => c !== null),
    semis, w1, w2, wf,
  };
}

export function computeEvent(state, ev, g) {
  switch (ev.type) {
    case 'rank': return computeRankEvent(state, ev, g);
    case 'count': return computeCountEvent(state, ev, g);
    case 'league': return computeLeagueEvent(state, ev, g);
    case 'tug': return computeTugEvent(state, ev, g);
    default: throw new Error('알 수 없는 종목 유형: ' + ev.type);
  }
}

export function eventStatus(res) {
  if (res.complete) return 'done';
  return res.started ? 'live' : 'wait';
}

// ───────── 학년 종합 순위 ─────────
export function computeGrade(state, g) {
  const events = {};
  for (const ev of EVENTS) events[ev.id] = computeEvent(state, ev, g);

  const rows = classes(g).map((c) => {
    const pts = {};
    const texts = {};
    let total = 0;
    for (const ev of EVENTS) {
      const r = events[ev.id].byClass[c];
      pts[ev.id] = r.points;
      texts[ev.id] = r.text;
      if (r.points !== null) total += r.points;
    }
    return { g, c, key: key(g, c), label: label(g, c), pts, texts, total };
  });

  const cmp = (a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    for (const id of TIE_BREAK) {
      const d = (b.pts[id] || 0) - (a.pts[id] || 0);
      if (d !== 0) return d;
    }
    return 0;
  };
  const sorted = [...rows].sort((a, b) => cmp(a, b) || a.c - b.c);
  const any = rows.some((r) => r.total > 0);
  let rank = 0;
  sorted.forEach((r, i) => {
    if (i === 0 || cmp(sorted[i - 1], r) !== 0) rank = i + 1;
    r.rank = any ? rank : null;
  });
  return { g, rows, sorted, events, any };
}

export function computeAll(state) {
  const out = {};
  for (const g of GRADES) out[g] = computeGrade(state, g);
  return out;
}

// ───────── 스포츠문화상 (종합 점수와 별도 집계) ─────────
export function computeCulture(state, g) {
  const rec = state.culture || {};
  const rows = classes(g).map((c) => {
    const r = rec[key(g, c)] || {};
    const vals = {};
    let total = 0;
    let filled = 0;
    for (const item of CULTURE) {
      const v = num(r[item.id]);
      vals[item.id] = v;
      if (v !== null) { total += v; filled++; }
    }
    return { g, c, label: label(g, c), vals, total: filled ? total : null, done: filled === CULTURE.length };
  });
  const ranks = competitionRanks(rows.filter((r) => r.done).map((r) => ({ id: r.c, v: r.total })));
  for (const r of rows) r.rank = r.done ? ranks[r.c] : null;
  return { g, rows };
}

// ───────── 계획서 내용: 프로그램 일정 (시간 · 학년 · 내용) ─────────
const ALL = [1, 2, 3];
export const SCHEDULE = [
  { part: '오전', from: '09:00', to: null, g: ALL, title: '운동장 집합', note: '각 학년 운동장 지정 장소에 집합' },
  { part: '오전', from: '09:00', to: '09:30', g: ALL, title: '반별 행진', note: '반별 행진 및 응원 구호' },
  { part: '오전', from: '09:30', to: '09:40', g: ALL, title: '개회식', note: '교장 선생님 개회사, 학생회장 페어플레이 선서' },
  { part: '오전', from: '09:40', to: '09:50', g: ALL, title: '준비운동 및 자리 이동', note: '' },
  { part: '오전', from: '09:50', to: '10:05', g: [1], title: '8자 마라톤', note: '' },
  { part: '오전', from: '10:05', to: '10:20', g: [2], title: '8자 마라톤', note: '' },
  { part: '오전', from: '10:20', to: '10:35', g: [3], title: '8자 마라톤', note: '' },
  { part: '오전', from: '10:35', to: '10:55', g: [1], title: '태풍 파도타기', note: '' },
  { part: '오전', from: '10:55', to: '11:15', g: [2], title: '태풍 파도타기', note: '' },
  { part: '오전', from: '11:15', to: '11:35', g: [3], title: '태풍 파도타기', note: '' },
  { part: '오전', from: '11:35', to: '12:25', g: ALL, title: '이어달리기 예선', note: '' },
  { part: '오전', from: '12:25', to: '12:40', g: [], who: '교육공동체', title: '교육공동체 미션 달리기', note: '교사 · 학부모 · 학생회 4인 1팀' },
  { part: '오전', from: '12:40', to: '13:25', g: ALL, title: '점심시간', note: '' },
  { part: '오전', from: '13:25', to: '13:30', g: ALL, title: '각 학급 자리로 집합', note: '' },
  { part: '오후', from: '13:30', to: '14:15', g: ALL, title: '줄다리기 본선(4강) 및 결승', note: '' },
  { part: '오후', from: '14:15', to: '14:45', g: ALL, title: '이어달리기 결승', note: '' },
  { part: '오후', from: '14:45', to: '15:00', g: ALL, title: '댄스반 공연', note: '운동장 중앙' },
  { part: '오후', from: '15:00', to: '15:10', g: ALL, title: '폐회식 및 시상', note: '' },
];

export const EVENT_INFO = {
  date: '2026. 10. 23. (금)',
  place: '마석중학교 운동장',
  rain: '우천 시 순연하여 진행',
};

export const TUG_PRELIM = '줄다리기 예선전: 3학년 10/12(월) · 2학년 10/20(화) · 1학년 10/21(수)';

export const PLEDGE = {
  title: '존중과 배려를 위한 우리들의 다짐',
  intro:
    '우리는 ‘승리보다 스포츠맨십’으로 함께하는 모두를 존중하고 배려하며 ‘최선을 다했다면 이기지 않아도 괜찮아’의 정신으로 다음과 같이 엄숙히 선서합니다.',
  items: [
    '심판의 판정에 항의하지 않겠습니다.',
    '상대방을 향한 비방이나 욕설을 하지 않겠습니다.',
    '상대방을 위협하는 위험한 플레이를 하지 않겠습니다.',
    '학생 신분에 어긋나는 행위를 하지 않겠습니다.',
    '경기 후, 경기장 정리 정돈을 철저히 하겠습니다.',
  ],
  date: '2026년 10월 23일',
  who: '마석중학교 학생대표 이 라 원',
};
