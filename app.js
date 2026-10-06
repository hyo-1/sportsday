// app.js
// 화면을 그리고(렌더링), 버튼/입력을 처리하고, Firebase와 데이터를 주고받는 파일입니다.
// 점수 계산은 logic.js, Firebase 설정값은 firebase-config.js에 있습니다.

import {
  GRADES, CLASS_COUNT, EVENTS, CULTURE, ADVANCE_PER_GROUP, TIE_BREAK,
  SCHEDULE, EVENT_INFO, TUG_PRELIM, PLEDGE, GROUPS,
  classes, label, key,
  computeAll, computeEvent, computeCulture, eventStatus,
} from './logic.js';
import { firebaseConfig, TEACHER_EMAIL } from './firebase-config.js';

const FIREBASE_CDN = 'https://www.gstatic.com/firebasejs/10.14.1/';
const configured = !!firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith('YOUR');
const DEMO_PIN = '123456';

const $ = (s) => document.querySelector(s);

// ───────────────────────── 데이터 저장소 (Firebase / 연습 모드) ─────────────────────────

// ['march','1_3'] , 5  →  { march: { '1_3': 5 } }
const nest = (path, value) => path.reduceRight((acc, k) => ({ [k]: acc }), value);

function deepSet(obj, path, value) {
  let o = obj;
  path.slice(0, -1).forEach((k) => { if (typeof o[k] !== 'object' || o[k] === null) o[k] = {}; o = o[k]; });
  o[path[path.length - 1]] = value;
}
function deepDel(obj, path) {
  let o = obj;
  for (const k of path.slice(0, -1)) { if (typeof o[k] !== 'object' || o[k] === null) return; o = o[k]; }
  delete o[path[path.length - 1]];
}

// 연습 모드: 데이터가 이 기기(브라우저)에만 저장됩니다. Firebase 설정 전 화면 확인용.
function demoStore() {
  const KEY = 'sportsday-demo-v1';
  let data = {};
  try { data = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { data = {}; }
  let logged = false;
  try { logged = localStorage.getItem(KEY + '-auth') === '1'; } catch (e) { logged = false; }
  const subs = [];
  const authSubs = [];
  const persist = () => {
    data.meta = { updated: Date.now() };
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* 저장 불가 시 무시 */ }
    subs.forEach((f) => f(data));
  };
  return {
    mode: 'demo',
    subscribe(cb, status) { subs.push(cb); cb(data); status('demo'); },
    async set(path, value) { deepSet(data, path, value); persist(); },
    async remove(path) { deepDel(data, path); persist(); },
    onAuth(cb) { authSubs.push(cb); cb(logged ? { email: 'demo' } : null); },
    async login(pin) {
      if (pin !== DEMO_PIN) { const e = new Error('wrong pin'); e.code = 'auth/invalid-credential'; throw e; }
      logged = true;
      try { localStorage.setItem(KEY + '-auth', '1'); } catch (e) { /* 무시 */ }
      authSubs.forEach((f) => f({ email: 'demo' }));
    },
    async logout() {
      logged = false;
      try { localStorage.removeItem(KEY + '-auth'); } catch (e) { /* 무시 */ }
      authSubs.forEach((f) => f(null));
    },
  };
}

// 진짜 모드: Firebase Firestore(실시간 데이터베이스) + Authentication(교사 로그인)
async function firebaseStore() {
  const [appMod, authMod, fsMod] = await Promise.all([
    import(FIREBASE_CDN + 'firebase-app.js'),
    import(FIREBASE_CDN + 'firebase-auth.js'),
    import(FIREBASE_CDN + 'firebase-firestore.js'),
  ]);
  const app = appMod.initializeApp(firebaseConfig);
  const auth = authMod.getAuth(app);
  const db = fsMod.getFirestore(app);
  const ref = fsMod.doc(db, 'sportsday', 'state'); // 모든 기록이 이 문서 하나에 들어갑니다.
  const withMeta = (o) => ({ ...o, meta: { updated: Date.now() } });
  return {
    mode: 'firebase',
    subscribe(cb, status) {
      fsMod.onSnapshot(
        ref,
        (snap) => { cb(snap.data() || {}); status('ok'); },
        (err) => { console.error(err); status('error'); },
      );
    },
    set: (path, value) => fsMod.setDoc(ref, withMeta(nest(path, value)), { merge: true }),
    remove: (path) => fsMod.setDoc(ref, withMeta(nest(path, fsMod.deleteField())), { merge: true }),
    onAuth: (cb) => authMod.onAuthStateChanged(auth, cb),
    login: (pin) => authMod.signInWithEmailAndPassword(auth, TEACHER_EMAIL, pin),
    logout: () => authMod.signOut(auth),
  };
}

// ───────────────────────── 앱 상태 ─────────────────────────

let store = null;
let state = {}; // Firebase에서 받아온 전체 기록
let user = null; // 교사 로그인 상태 (null이면 관람 모드)
let status = 'connecting'; // connecting | ok | demo | error

function loadMy() {
  try {
    const v = JSON.parse(localStorage.getItem('sd-my') || '{}');
    if (GRADES.includes(v.g) && v.c >= 1 && v.c <= CLASS_COUNT[v.g]) return { g: v.g, c: v.c };
  } catch (e) { /* 무시 */ }
  return { g: 0, c: 0 };
}
const ui = { tab: 'rank', rankG: 1, evId: 'march', evG: 1, cultG: 1, planG: 0, my: loadMy() };
const canEdit = () => !!user;

const TABS = [
  { id: 'rank', name: '순위', icon: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>' },
  { id: 'event', name: '종목', icon: '<path d="M5 21V4"/><path d="M5 4h12l-2.5 4L17 12H5"/>' },
  { id: 'culture', name: '문화상', icon: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.5 2.9 1-6.1L3.1 9.5l6.1-.9z"/>' },
  { id: 'plan', name: '일정', icon: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>' },
  { id: 'points', name: '배점표', icon: '<path d="M5 20V11M12 20V4M19 20v-6"/>' },
  { id: 'pledge', name: '선언문', icon: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>' },
];

// ───────────────────────── 작은 도우미들 ─────────────────────────

const pt = (p) => (p === null || p === undefined ? '<td class="dim">·</td>' : `<td class="num">${p}</td>`);
const ptText = (p) => (p === null || p === undefined ? '-' : `${p}점`);
const fmtTime = (ms) => new Date(ms).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
const rk = (r) => (r === null || r === undefined ? '<span class="rk">-</span>' : `<span class="rk ${r <= 3 ? 'r' + r : ''}">${r}</span>`);

let toastTimer = null;
function flash(msg, bad = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (bad ? ' bad' : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, bad ? 3500 : 1200);
}

function errText(e) {
  const code = (e && e.code) || '';
  if (code.includes('permission-denied')) return '저장 권한이 없어요. 교사 로그인과 보안 규칙을 확인해 주세요.';
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found') || code.includes('invalid-login'))
    return '번호가 맞지 않아요. 다시 입력해 주세요.';
  if (code.includes('too-many-requests')) return '시도가 너무 많아요. 잠시 후 다시 해 주세요.';
  if (code.includes('network')) return '인터넷 연결을 확인해 주세요.';
  return '저장하지 못했어요: ' + (code || (e && e.message) || '알 수 없는 오류');
}

// 저장을 요청하고, 결과를 작은 알림으로 알려줍니다.
function write(p) {
  Promise.resolve(p).then(() => flash('저장됨')).catch((e) => { console.error(e); flash(errText(e), true); });
}
const setVal = (path, value) => write(store.set(path, value));
const delVal = (path) => write(store.remove(path));

function putNumber(path, raw, max) {
  const v = raw === '' ? null : Number(raw);
  if (v === null || !Number.isFinite(v) || v < 0) { delVal(path); return null; }
  const n = Math.min(Math.round(v), max === undefined ? 9999 : max);
  setVal(path, n);
  return n;
}

// ───────────────────────── 화면 만들기 ─────────────────────────

function renderTop() {
  const text = {
    ok: '실시간 연결됨',
    demo: '연습 모드 · 이 기기에만 저장돼요',
    error: '연결 오류 · 새로고침 해 보세요',
    connecting: '연결 중…',
  }[status];
  const dot = { ok: '', demo: 'demo', error: 'error', connecting: 'connecting' }[status];
  const upd = state.meta && state.meta.updated ? ` · 마지막 입력 ${fmtTime(state.meta.updated)}` : '';
  $('#top').innerHTML = `
    <div class="top-inner">
      <div class="kicker">2026 교과연계 마석중 스포츠클럽축제 · 10월 23일</div>
      <h1>체육대회 실시간 현황판</h1>
      <div class="top-row">
        <span class="live"><i class="dot ${dot}"></i>${text}${upd}</span>
        ${user ? '' : '<button class="btn light sm" data-action="login-open">점수 입력</button>'}
      </div>
    </div>`;
  const bar = $('#editbar');
  bar.hidden = !user;
  bar.innerHTML = user
    ? `<div class="editbar-inner"><span>점수 입력 모드 · 입력하면 모두의 화면에 바로 반영돼요</span><button class="btn amber sm" data-action="logout">입력 끝내기</button></div>`
    : '';
}

function renderNav() {
  $('#nav').innerHTML = TABS.map(
    (t) => `<button class="${t.id === ui.tab ? 'on' : ''}" data-action="tab" data-id="${t.id}" aria-label="${t.name}">
      <svg viewBox="0 0 24 24" aria-hidden="true">${t.icon}</svg><span>${t.name}</span></button>`,
  ).join('');
}

const gradeSeg = (action, current) =>
  `<div class="seg" role="tablist">${GRADES.map(
    (g) => `<button class="${g === current ? 'on' : ''}" data-action="${action}" data-g="${g}">${g}학년</button>`,
  ).join('')}</div>`;

// ── 1. 순위 ──

function myClassCard(all) {
  const { g, c } = ui.my;
  const gOpts =
    '<option value="0">학년 선택</option>' +
    GRADES.map((x) => `<option value="${x}" ${x === g ? 'selected' : ''}>${x}학년</option>`).join('');
  const cOpts =
    '<option value="0">반 선택</option>' +
    (g ? classes(g).map((x) => `<option value="${x}" ${x === c ? 'selected' : ''}>${x}반</option>`).join('') : '');
  let body = '<div class="empty">학년과 반을 고르면 우리 반 기록을 바로 볼 수 있어요.</div>';
  if (g && c) {
    const row = all[g].rows.find((r) => r.c === c);
    const cul = computeCulture(state, g).rows.find((r) => r.c === c);
    const tiles = EVENTS.map(
      (ev) => `<div class="tile"><div class="t-name">${ev.name}</div><div class="t-res">${row.texts[ev.id]}</div><div class="t-pt">${ptText(row.pts[ev.id])}</div></div>`,
    ).join('');
    const culRes = cul.done ? `${cul.rank}위` : cul.total === null ? '-' : '집계중';
    const culPt = cul.total === null ? '-' : `${cul.total}점`;
    body = `
      <div class="my-hero">
        <div><div class="lbl">${label(g, c)} 종합 점수</div><div class="big">${row.total}점</div></div>
        <div style="text-align:right"><div class="lbl">${g}학년 순위</div><div class="big">${row.rank === null ? '-' : row.rank + '위'}</div></div>
      </div>
      <div class="tiles">${tiles}
        <div class="tile sub"><div class="t-name">스포츠문화상 (별도)</div><div class="t-res">${culRes}</div><div class="t-pt">${culPt}</div></div>
      </div>`;
  }
  return `
    <section class="card">
      <div class="sec-head"><h2>우리 반 기록</h2></div>
      <div class="pick">
        <select data-act="myG" aria-label="학년">${gOpts}</select>
        <select data-act="myC" aria-label="반">${cOpts}</select>
      </div>
      ${body}
    </section>`;
}

function viewRank() {
  const all = computeAll(state);
  const gr = all[ui.rankG];
  const chips = EVENTS.map((ev) => {
    const st = eventStatus(gr.events[ev.id]);
    return `<span class="badge ${st}">${ev.name} ${{ done: '완료', live: '진행중', wait: '대기' }[st]}</span>`;
  }).join('');

  let podium = '<div class="empty">아직 입력된 기록이 없어요. 경기가 시작되면 여기에 순위가 나타나요.</div>';
  if (gr.any) {
    const top = gr.sorted.slice(0, 3);
    const order = [1, 0, 2].filter((i) => top[i]);
    podium = `<div class="podium">${order
      .map((i) => {
        const r = top[i];
        return `<div class="pod ${i === 0 ? 'r1' : ''}"><div class="medal m${Math.min(r.rank, 4)}">${r.rank}</div><div class="cls">${r.label}</div><div class="pt">${r.total}점</div></div>`;
      })
      .join('')}</div>`;
  }

  const me = ui.my;
  const rows = gr.sorted
    .map(
      (r) => `<tr class="click ${me.g === r.g && me.c === r.c ? 'me' : ''}" data-action="pickmy" data-g="${r.g}" data-c="${r.c}">
        <td>${rk(r.rank)}</td><td class="cls">${r.label}</td>
        ${EVENTS.map((ev) => pt(r.pts[ev.id])).join('')}
        <td class="total">${r.total}</td></tr>`,
    )
    .join('');

  return `
    ${myClassCard(all)}
    <section class="card">
      <div class="sec-head"><h2>학년별 실시간 순위</h2></div>
      ${gradeSeg('rankg', ui.rankG)}
      <div class="status-row">${chips}</div>
      ${podium}
      <div class="tbl-wrap"><table class="rank-tbl">
        <thead><tr><th>순위</th><th>반</th>${EVENTS.map((ev) => `<th>${ev.head.join('<br>')}</th>`).join('')}<th>합계</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <p class="hint">반을 누르면 위의 “우리 반 기록”에서 볼 수 있어요. 동점이면 ${TIE_BREAK.map((id) => EVENTS.find((e) => e.id === id).name).join(' → ')} 점수가 높은 반이 앞서요. 경기가 끝나기 전 순위는 잠정이에요.</p>
    </section>`;
}

// ── 2. 종목 ──

function pointStrip(ev) {
  const names = ev.type === 'tug' ? ['1위', '2위', '공동 3위', null, '5위 이하'] : ['1위', '2위', '3위', '4위', '5위 이하'];
  return `<div class="status-row">${ev.points
    .map((p, i) => (p === null || names[i] === null ? '' : `<span class="badge">${names[i]} ${p}점</span>`))
    .join('')}</div>`;
}

function marchBody(ev, g, res, edit) {
  const rows = classes(g)
    .map((c) => {
      const r = res.byClass[c];
      const cell = edit
        ? `<select data-act="march" data-c="${c}"><option value="">순위 선택</option>${[1, 2, 3, 4, 5]
            .map((n) => `<option value="${n}" ${r.rank === n ? 'selected' : ''}>${n === 5 ? '5위 이하' : n + '위'}</option>`)
            .join('')}</select>`
        : `<b>${r.text}</b>`;
      return `<tr><td class="cls">${label(g, c)}</td><td>${cell}</td>${pt(r.points)}</tr>`;
    })
    .join('');
  return `<div class="tbl-wrap"><table><thead><tr><th>반</th><th>순위</th><th>점수</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${edit ? '<p class="hint">심사 결과 순위를 골라 주세요. 5위부터는 모두 “5위 이하”로 입력해요.</p>' : ''}`;
}

function marathonBody(ev, g, res, edit) {
  const groups = GROUPS[g].map((m, i) => `${i + 1}조 ${m.map((c) => label(g, c)).join(' · ')}`).join('<br>');
  const rows = classes(g)
    .map((c) => {
      const r = res.byClass[c];
      const inp = (f, v) =>
        edit
          ? `<td><input class="num" type="number" inputmode="numeric" min="0" data-act="mar" data-f="${f}" data-c="${c}" value="${v === null ? '' : v}" aria-label="${label(g, c)} ${f === 'a' ? '1차' : '2차'} 횟수"></td>`
          : `<td class="num">${v === null ? '-' : v}</td>`;
      return `<tr><td class="cls">${label(g, c)}</td>${inp('a', r.a)}${inp('b', r.b)}
        <td class="num"><b>${r.total === null ? '-' : r.total}</b></td><td>${r.rank === null ? '<span class="muted">' + (r.total === null ? '-' : '집계중') + '</span>' : rk(r.rank)}</td>${pt(r.points)}</tr>`;
    })
    .join('');
  return `
    <div class="grp"><div class="grp-head"><b>조 편성</b></div><div class="muted">${groups}</div></div>
    <div class="tbl-wrap"><table><thead><tr><th>반</th><th>1차<br>(횟수)</th><th>2차<br>(횟수)</th><th>합계</th><th>순위</th><th>점수</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="hint">${edit ? '1차·2차 뛰어넘은 횟수를 입력하면 합계가 높은 순으로 순위가 자동 계산돼요.' : '두 번의 기록을 합한 횟수가 높은 순서로 순위가 정해져요.'}</p>`;
}

function leagueBody(ev, g, res, edit) {
  const grp = res.groups
    .map(
      (gr) => `<div class="grp">
        <div class="grp-head"><b>${gr.no}조 예선</b><span class="${gr.done ? 'full' : ''}">결승 진출 ${gr.advanced.length}/${ADVANCE_PER_GROUP}</span></div>
        <div class="cls-chips">${gr.members
          .map((c) =>
            edit
              ? `<button class="cc ${gr.advanced.includes(c) ? 'adv' : ''}" data-action="adv" data-ev="${ev.id}" data-c="${c}">${label(g, c)}</button>`
              : `<div class="cc ${gr.advanced.includes(c) ? 'adv' : ''}">${label(g, c)}</div>`,
          )
          .join('')}</div>
      </div>`,
    )
    .join('');

  const fin = res.finalists
    .map((c) => ({ c, r: res.byClass[c] }))
    .sort((a, b) => (a.r.rank === null ? 99 : a.r.rank) - (b.r.rank === null ? 99 : b.r.rank) || a.c - b.c);
  const ranks = fin.map((x) => x.r.rank).filter((r) => r !== null);
  const dup = ranks.length !== new Set(ranks).size;
  const finHtml = fin.length
    ? fin
        .map(({ c, r }) => {
          const cell = edit
            ? `<select data-act="fin" data-ev="${ev.id}" data-c="${c}"><option value="">순위 선택</option>${[1, 2, 3, 4, 5, 6]
                .map((n) => `<option value="${n}" ${r.rank === n ? 'selected' : ''}>${n}위</option>`)
                .join('')}</select>`
            : `<b>${r.text}</b>`;
          return `<div class="fin-row"><span class="cls">${label(g, c)}</span>${cell}<span class="pts">${ptText(r.points)}</span></div>`;
        })
        .join('') + (dup ? '<div class="warn">같은 순위가 2개 이상 있어요. 공동 순위가 맞는지 확인해 주세요.</div>' : '')
    : '<div class="empty">예선에서 이긴 반을 고르면 자동으로 결승 리그에 올라가요.</div>';

  const rows = classes(g)
    .map((c) => {
      const r = res.byClass[c];
      return `<tr><td class="cls">${label(g, c)}</td><td>${r.text}</td>${pt(r.points)}</tr>`;
    })
    .join('');

  return `
    <div class="sub-title">조 편성 · 예선 ${edit ? '<span class="muted">(이긴 반을 눌러 선택, 다시 누르면 취소)</span>' : ''}</div>
    ${grp}
    <div class="sub-title">결승 리그 (${fin.length}/${res.groups.length * ADVANCE_PER_GROUP}개 반)</div>
    <div class="grp final-box">${finHtml}</div>
    <div class="sub-title">반별 점수</div>
    <div class="tbl-wrap"><table><thead><tr><th>반</th><th>결과</th><th>점수</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function tugBody(ev, g, res, edit) {
  const slotSel = (i) => {
    const cur = res.semis[i];
    return `<select data-act="semi" data-slot="${i}" aria-label="4강 ${i + 1}번째 반">
      <option value="">반 선택</option>
      ${classes(g)
        .map((c) => `<option value="${c}" ${c === cur ? 'selected' : ''} ${res.semis.some((x, j) => j !== i && x === c) ? 'disabled' : ''}>${label(g, c)}</option>`)
        .join('')}</select>`;
  };
  const team = (slotKey, c, winner, active) =>
    c === null || c === undefined
      ? '<div class="team empty-t">-</div>'
      : edit && active
        ? `<button class="team ${winner === c ? 'win' : ''}" data-action="win" data-slot="${slotKey}" data-c="${c}">${label(g, c)}</button>`
        : `<div class="team ${winner === c ? 'win' : ''}">${label(g, c)}</div>`;
  const [s0, s1, s2, s3] = res.semis;
  const match = (title, a, b, ia, ib, winKey, winner) => `
    <div class="match">
      <h3>${title}</h3>
      ${edit ? `<div class="vs">${slotSel(ia)}<span class="x">VS</span>${slotSel(ib)}</div><div class="win-note">이긴 반을 눌러 주세요</div>` : ''}
      <div class="vs" style="margin-top:8px">${team(winKey, a, winner, a !== null && b !== null)}<span class="x">VS</span>${team(winKey, b, winner, a !== null && b !== null)}</div>
    </div>`;
  const finalMatch = `
    <div class="match final">
      <h3>결승</h3>
      <div class="vs">${team('wf', res.w1, res.wf, res.w1 !== null && res.w2 !== null)}<span class="x">VS</span>${team('wf', res.w2, res.wf, res.w1 !== null && res.w2 !== null)}</div>
      <div class="win-note">${res.wf !== null ? label(g, res.wf) + ' 우승!' : '4강 승자끼리 결승에서 만나요'}</div>
    </div>`;
  const rows = classes(g)
    .map((c) => {
      const r = res.byClass[c];
      return `<tr><td class="cls">${label(g, c)}</td><td>${r.text}</td>${pt(r.points)}</tr>`;
    })
    .join('');
  return `
    <p class="hint" style="margin:0 0 10px">${TUG_PRELIM}</p>
    <div class="sub-title">4강 · 결승</div>
    ${match('4강 1경기', s0, s1, 0, 1, 'w1', res.w1)}
    ${match('4강 2경기', s2, s3, 2, 3, 'w2', res.w2)}
    ${finalMatch}
    <div class="sub-title">반별 점수</div>
    <div class="tbl-wrap"><table><thead><tr><th>반</th><th>결과</th><th>점수</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="hint">4강에서 진 두 반은 공동 3위, 4강에 오르지 못한 반은 5위 이하 점수예요.</p>`;
}

function viewEvent() {
  const ev = EVENTS.find((e) => e.id === ui.evId);
  const g = ui.evG;
  const res = computeEvent(state, ev, g);
  const edit = canEdit();
  const body = { rank: marchBody, count: marathonBody, league: leagueBody, tug: tugBody }[ev.type](ev, g, res, edit);
  const st = eventStatus(res);
  return `
    <section class="card">
      <div class="chips">${EVENTS.map((e) => `<button class="${e.id === ev.id ? 'on' : ''}" data-action="ev" data-id="${e.id}">${e.name}</button>`).join('')}</div>
      ${gradeSeg('evg', g)}
      <div class="sec-head"><h2>${ev.name} · ${g}학년</h2><span class="badge ${st}">${{ done: '입력 완료', live: '진행중', wait: '대기' }[st]}</span></div>
      ${pointStrip(ev)}
      ${body}
    </section>`;
}

// ── 3. 스포츠문화상 ──

function viewCulture() {
  const g = ui.cultG;
  const res = computeCulture(state, g);
  const edit = canEdit();
  const rows = res.rows
    .map((r) => {
      const cells = CULTURE.map((it) =>
        edit
          ? `<td><input class="num" type="number" inputmode="numeric" min="0" max="${it.max}" data-act="cult" data-f="${it.id}" data-c="${r.c}" value="${r.vals[it.id] === null ? '' : r.vals[it.id]}" aria-label="${r.label} ${it.name}"></td>`
          : `<td class="num">${r.vals[it.id] === null ? '-' : r.vals[it.id]}</td>`,
      ).join('');
      return `<tr><td class="cls">${r.label}</td>${cells}<td class="total">${r.total === null ? '-' : r.total}</td><td>${r.done ? rk(r.rank) : '<span class="muted">-</span>'}</td></tr>`;
    })
    .join('');
  return `
    <section class="card">
      <div class="sec-head"><h2>스포츠문화상</h2><span class="muted">종합 점수와 별도로 집계돼요</span></div>
      ${gradeSeg('cultg', g)}
      <div class="tbl-wrap"><table class="cult-tbl">
        <thead><tr><th>반</th>${CULTURE.map((it) => `<th>${it.name}<br>(${it.max})</th>`).join('')}<th>계<br>(100)</th><th>순위</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <p class="hint">${CULTURE.filter((it) => it.sub).map((it) => `${it.name}: ${it.sub}`).join(' / ')}<br>채점 급간: 3점 · 세 항목이 모두 입력된 반부터 순위가 나와요.</p>
    </section>`;
}

// ── 4. 일정 ──

function nowIndex(items) {
  const d = new Date();
  if (d.getFullYear() !== 2026 || d.getMonth() !== 9 || d.getDate() !== 23) return -1;
  const m = d.getHours() * 60 + d.getMinutes();
  const toMin = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  return items.findIndex((it) => {
    const a = toMin(it.from);
    const b = it.to ? toMin(it.to) : a + 5;
    return m >= a && m < b;
  });
}

function viewPlan() {
  const g = ui.planG;
  const items = SCHEDULE.filter((it) => g === 0 || it.g.includes(g) || it.who);
  const now = nowIndex(items);
  const gradePills = (it) =>
    it.who ? `<span class="pill comm">${it.who}</span>` : it.g.length === 3 ? '<span class="pill all">전 학년</span>' : it.g.map((x) => `<span class="pill">${x}학년</span>`).join('');
  const li = (it, i) => `
    <li class="${i === now ? 'now' : ''}">
      <div class="tm">${it.from}${it.to ? `<small>~ ${it.to}</small>` : ''}</div>
      <div><div class="tt">${it.title}${i === now ? ' <span class="pill" style="background:var(--amber);color:#fff">지금</span>' : ''}</div>
        <div>${gradePills(it)}</div>${it.note ? `<div class="tn">${it.note}</div>` : ''}</div>
    </li>`;
  const part = (name) => {
    const list = items.map((it, i) => ({ it, i })).filter((x) => x.it.part === name);
    return `<div class="part">${name}</div><ul class="tl">${list.map((x) => li(x.it, x.i)).join('')}</ul>`;
  };
  const seg = `<div class="seg">${[0, 1, 2, 3].map((x) => `<button class="${x === g ? 'on' : ''}" data-action="plang" data-g="${x}">${x === 0 ? '전체' : x + '학년'}</button>`).join('')}</div>`;
  return `
    <section class="card">
      <div class="sec-head"><h2>프로그램 일정</h2></div>
      <div class="when"><b>${EVENT_INFO.date}</b><div class="muted">${EVENT_INFO.place} · ${EVENT_INFO.rain}</div></div>
      ${seg}
      ${part('오전')}${part('오후')}
    </section>`;
}

// ── 5. 배점표 ──

function viewPoints() {
  const rows = EVENTS.map((ev) => {
    const cells = ev.points
      .map((p, i) => (p === null ? '<td class="dim">-</td>' : `<td class="num">${p}${ev.type === 'tug' && i === 2 ? '<br><small class="muted">공동</small>' : ''}</td>`))
      .join('');
    return `<tr><td class="ev">${ev.name}</td>${cells}</tr>`;
  }).join('');
  const cul = CULTURE.map((it) => `<tr><td class="ev">${it.name}</td><td class="num">${it.max}</td><td style="text-align:left;font-size:13px">${it.sub || ''}</td></tr>`).join('');
  return `
    <section class="card">
      <div class="sec-head"><h2>종목별 배점표</h2></div>
      <div class="tbl-wrap"><table class="pts-tbl">
        <thead><tr><th style="text-align:left;padding-left:8px">종목</th><th>1위</th><th>2위</th><th>3위</th><th>4위</th><th>5위<br>이하</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <ul class="rules">
        <li>종합 점수는 5개 종목 점수를 모두 더한 값이에요.</li>
        <li>순위는 학년 안에서 따로 매겨요. (1학년끼리, 2학년끼리, 3학년끼리)</li>
        <li>종합 점수가 같으면 ${TIE_BREAK.map((id) => EVENTS.find((e) => e.id === id).name).join(' → ')} 점수가 높은 반이 앞서요.</li>
        <li>태풍 파도타기·이어달리기는 조별 3개 반(총 6개 반)이 결승에 올라가요. 예선에서 탈락한 반은 5위 이하 점수예요.</li>
        <li>줄다리기는 4강 진출 반 중 우승 150점, 준우승 120점, 4강에서 진 두 반은 공동 3위 100점, 나머지는 50점이에요.</li>
      </ul>
    </section>
    <section class="card">
      <div class="sec-head"><h2>스포츠문화상 채점 기준</h2><span class="muted">종합 점수와 별도</span></div>
      <div class="tbl-wrap"><table class="pts-tbl">
        <thead><tr><th style="text-align:left;padding-left:8px">항목</th><th>배점</th><th style="text-align:left">내용</th></tr></thead>
        <tbody>${cul}</tbody></table></div>
      <p class="hint">합계 100점 · 채점 급간 3점</p>
    </section>`;
}

// ── 6. 선언문 ──

function viewPledge() {
  return `
    <section class="pledge">
      <h2>페어플레이 선언문</h2>
      <p style="text-align:center;font-weight:800;color:var(--navy);font-size:18px;margin-bottom:14px">${PLEDGE.title}</p>
      <p class="intro">${PLEDGE.intro}</p>
      <ol>${PLEDGE.items.map((t) => `<li>${t}</li>`).join('')}</ol>
      <div class="sign">${PLEDGE.date}<br><b>${PLEDGE.who}</b></div>
    </section>`;
}

const VIEWS = { rank: viewRank, event: viewEvent, culture: viewCulture, plan: viewPlan, points: viewPoints, pledge: viewPledge };

// ───────────────────────── 그리기 (입력하던 칸을 잃지 않도록 처리) ─────────────────────────

function focusSnapshot() {
  const a = document.activeElement;
  const main = $('#main');
  if (!a || !main.contains(a) || !(a.tagName === 'INPUT' || a.tagName === 'SELECT')) return null;
  const sel = Array.from(a.attributes)
    .filter((x) => x.name.startsWith('data-'))
    .map((x) => `[${x.name}="${x.value}"]`)
    .join('');
  return sel ? { sel: a.tagName.toLowerCase() + sel, value: a.value } : null;
}

function render() {
  const snap = focusSnapshot();
  renderTop();
  renderNav();
  const main = $('#main');
  main.className = 'wrap' + (canEdit() ? ' edit-on' : '');
  main.innerHTML = VIEWS[ui.tab]();
  if (snap) {
    const el = main.querySelector(snap.sel);
    if (el) {
      if (el.value !== snap.value) el.value = snap.value; // 입력 중이던 값 유지
      el.focus({ preventScroll: true });
    }
  }
}

let renderTimer = null;
function queueRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(render, 30);
}

// ───────────────────────── 줄다리기 저장 도우미 ─────────────────────────

function applyTug(g, patch) {
  const old = (state.tug || {})[g] || {};
  const t = { ...old };
  for (const [k, v] of Object.entries(patch)) { if (v === null) delete t[k]; else t[k] = v; }
  const n = (v) => (typeof v === 'number' ? v : null);
  const ok = (w, a, b) => w !== null && a !== null && b !== null && (w === a || w === b);
  // 대진이 바뀌어서 맞지 않게 된 승자 기록은 함께 지웁니다.
  if (!ok(n(t.w1), n(t.s0), n(t.s1))) delete t.w1;
  if (!ok(n(t.w2), n(t.s2), n(t.s3))) delete t.w2;
  if (!ok(n(t.wf), n(t.w1), n(t.w2))) delete t.wf;
  for (const f of ['s0', 's1', 's2', 's3', 'w1', 'w2', 'wf']) {
    if (t[f] !== old[f]) {
      if (t[f] === undefined) delVal(['tug', String(g), f]);
      else setVal(['tug', String(g), f], t[f]);
    }
  }
}

// ───────────────────────── 클릭 · 입력 처리 ─────────────────────────

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const d = el.dataset;
  switch (d.action) {
    case 'tab': ui.tab = d.id; window.scrollTo(0, 0); render(); break;
    case 'rankg': ui.rankG = Number(d.g); render(); break;
    case 'ev': ui.evId = d.id; render(); break;
    case 'evg': ui.evG = Number(d.g); render(); break;
    case 'cultg': ui.cultG = Number(d.g); render(); break;
    case 'plang': ui.planG = Number(d.g); render(); break;
    case 'pickmy':
      ui.my = { g: Number(d.g), c: Number(d.c) };
      try { localStorage.setItem('sd-my', JSON.stringify(ui.my)); } catch (err) { /* 무시 */ }
      window.scrollTo(0, 0);
      render();
      break;
    case 'login-open': openLogin(); break;
    case 'login-cancel': $('#loginModal').hidden = true; break;
    case 'logout': store.logout().then(() => flash('입력 모드를 끝냈어요')); break;
    case 'adv': {
      if (!canEdit()) return;
      const g = ui.evG;
      const c = Number(d.c);
      const k = key(g, c);
      const cur = ((state[d.ev] || {}).adv || {})[k] === true;
      if (cur) {
        delVal([d.ev, 'adv', k]);
        delVal([d.ev, 'final', k]);
      } else {
        const res = computeEvent(state, EVENTS.find((x) => x.id === d.ev), g);
        const grp = res.groups.find((x) => x.members.includes(c));
        if (grp.advanced.length >= ADVANCE_PER_GROUP) { flash(`한 조에서는 ${ADVANCE_PER_GROUP}개 반만 진출해요`, true); return; }
        setVal([d.ev, 'adv', k], true);
      }
      break;
    }
    case 'win': {
      if (!canEdit()) return;
      const g = ui.evG;
      const c = Number(d.c);
      const cur = ((state.tug || {})[g] || {})[d.slot];
      applyTug(g, { [d.slot]: cur === c ? null : c });
      break;
    }
    default: break;
  }
});

document.addEventListener('change', (e) => {
  const t = e.target;
  const act = t.dataset && t.dataset.act;
  if (!act) return;

  // 관람용 선택 (로그인 필요 없음)
  if (act === 'myG') {
    ui.my = { g: Number(t.value), c: 0 };
    try { localStorage.setItem('sd-my', JSON.stringify(ui.my)); } catch (err) { /* 무시 */ }
    render();
    return;
  }
  if (act === 'myC') {
    ui.my = { g: ui.my.g, c: Number(t.value) };
    try { localStorage.setItem('sd-my', JSON.stringify(ui.my)); } catch (err) { /* 무시 */ }
    render();
    return;
  }

  // 아래는 입력 모드에서만
  if (!canEdit()) return;
  const g = ui.evG;
  const c = Number(t.dataset.c);
  switch (act) {
    case 'march': t.value === '' ? delVal(['march', key(g, c)]) : setVal(['march', key(g, c)], Number(t.value)); break;
    case 'mar': putNumber(['marathon', key(g, c), t.dataset.f], t.value, 9999); break;
    case 'fin': t.value === '' ? delVal([t.dataset.ev, 'final', key(g, c)]) : setVal([t.dataset.ev, 'final', key(g, c)], Number(t.value)); break;
    case 'semi': applyTug(g, { ['s' + t.dataset.slot]: t.value === '' ? null : Number(t.value) }); break;
    case 'cult': {
      const item = CULTURE.find((x) => x.id === t.dataset.f);
      const gg = ui.cultG;
      const v = putNumber(['culture', key(gg, c), item.id], t.value, item.max);
      t.value = v === null ? '' : v; // 최고점을 넘으면 최고점으로 맞춰 줍니다
      break;
    }
    default: break;
  }
});

// ───────────────────────── 교사 로그인 ─────────────────────────

function openLogin() {
  $('#loginErr').textContent = '';
  $('#pin').value = '';
  const note = $('#loginModal .muted');
  note.textContent = store && store.mode === 'demo' ? '연습 모드예요. 번호는 123456 입니다.' : '교사용 번호(숫자 6자리)를 입력하세요.';
  $('#loginModal').hidden = false;
  setTimeout(() => $('#pin').focus(), 50);
}

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!store) return;
  const btn = $('#loginBtn');
  btn.disabled = true;
  $('#loginErr').textContent = '';
  try {
    await store.login($('#pin').value.trim());
    $('#loginModal').hidden = true;
    flash('입력 모드가 켜졌어요');
  } catch (err) {
    console.error(err);
    $('#loginErr').textContent = errText(err);
  } finally {
    btn.disabled = false;
  }
});

// ───────────────────────── 시작 ─────────────────────────

async function init() {
  render();
  try {
    store = configured ? await firebaseStore() : demoStore();
  } catch (err) {
    console.error(err);
    status = 'error';
    render();
    return;
  }
  store.onAuth((u) => { user = u; queueRender(); });
  store.subscribe(
    (data) => { state = data; queueRender(); },
    (s) => { status = s; queueRender(); },
  );
  // 일정 화면의 "지금" 표시가 시간이 지나도 맞도록 1분마다 다시 그립니다.
  setInterval(() => { if (ui.tab === 'plan') queueRender(); }, 60000);
}

init();
