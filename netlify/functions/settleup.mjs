// MEGAKÁMÍCI — Settle Up bilance (read-only bot)
const KEY = "AIzaSyCL5929OM079CEJRa9clwJB-UUxAofSQKY";
const DB = "https://settle-up-live.firebaseio.com";
let tokCache = { token: null, exp: 0 };

async function getToken() {
  if (tokCache.token && Date.now() < tokCache.exp) return tokCache.token;
  const r = await fetch("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=" + KEY, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Referer": "https://settleup.app/" },
    body: JSON.stringify({ email: process.env.SETTLEUP_EMAIL, password: process.env.SETTLEUP_PASSWORD, returnSecureToken: true })
  });
  const d = await r.json();
  if (!d.idToken) throw new Error("auth failed: " + JSON.stringify(d.error || {}));
  tokCache = { token: d.idToken, exp: Date.now() + 50 * 60 * 1000 };
  return d.idToken;
}

async function dbGet(path, tok) {
  const r = await fetch(`${DB}/${path}.json?auth=${tok}`);
  if (!r.ok) throw new Error(`db ${path}: ${r.status}`);
  return r.json();
}

export default async (req) => {
  try {
    const gid = process.env.SETTLEUP_GROUP_ID;
    const tok = await getToken();
    const [group, members, debts, txs] = await Promise.all([
      dbGet(`groups/${gid}`, tok),
      dbGet(`members/${gid}`, tok),
      dbGet(`debts/${gid}`, tok),
      dbGet(`transactions/${gid}`, tok)
    ]);
    const gcur = (group && group.convertedToCurrency) || "CZK";
    const mem = {};
    Object.entries(members || {}).forEach(([id, m]) => { mem[id] = m.name; });
    let spent = 0;
    const paidBy = {};
    Object.values(txs || {}).forEach(t => {
      if (t.type !== "expense") return;
      let total = 0;
      (t.items || []).forEach(it => { total += parseFloat(it.amount) || 0; });
      if (t.currencyCode !== gcur) {
        const rate = t.exchangeRates && parseFloat(t.exchangeRates[gcur]);
        if (rate) total = total / rate;
      }
      spent += total;
      const wp = t.whoPaid || [];
      const wsum = wp.reduce((s, w) => s + (parseFloat(w.weight) || 0), 0) || 1;
      wp.forEach(w => { paidBy[w.memberId] = (paidBy[w.memberId] || 0) + total * ((parseFloat(w.weight) || 0) / wsum); });
    });
    const body = JSON.stringify({
      ok: true, group: group && group.name, currency: gcur, members: mem,
      debts: (debts || []).map(d => ({ from: d.from, to: d.to, amount: parseFloat(d.amount) })),
      spent: Math.round(spent), paidBy: Object.fromEntries(Object.entries(paidBy).map(([k, v]) => [k, Math.round(v)])),
      txCount: Object.keys(txs || {}).length, ts: Date.now()
    });
    return new Response(body, { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=0, s-maxage=120", "Access-Control-Allow-Origin": "*" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e.message || e) }), { status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
  }
};

export const config = { path: "/api/settleup" };
