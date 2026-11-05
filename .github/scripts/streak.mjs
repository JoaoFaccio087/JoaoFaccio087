// Gera os cards de streak (claro e escuro) a partir da API GraphQL do GitHub.
// Uso: GITHUB_TOKEN=... node .github/scripts/streak.mjs <usuario> <pasta-saida>
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [user = process.env.GITHUB_REPOSITORY_OWNER, outDir = "profile"] = process.argv.slice(2);
const token = process.env.GITHUB_TOKEN;

async function gql(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

async function fetchDays() {
  const { user: u } = await gql(
    `query($login:String!){ user(login:$login){ createdAt contributionsCollection{ contributionYears } } }`,
    { login: user },
  );
  const days = [];
  for (const year of u.contributionsCollection.contributionYears) {
    const data = await gql(
      `query($login:String!,$from:DateTime!,$to:DateTime!){ user(login:$login){
        contributionsCollection(from:$from,to:$to){ contributionCalendar{ weeks{ contributionDays{ date contributionCount } } } } } }`,
      { login: user, from: `${year}-01-01T00:00:00Z`, to: `${year}-12-31T23:59:59Z` },
    );
    for (const w of data.user.contributionsCollection.contributionCalendar.weeks)
      for (const d of w.contributionDays) days.push({ date: d.date, count: d.contributionCount });
  }
  const today = new Date().toISOString().slice(0, 10);
  const map = new Map(days.filter((d) => d.date <= today).map((d) => [d.date, d.count]));
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count }));
}

export function computeStats(days) {
  const total = days.reduce((s, d) => s + d.count, 0);
  const firstDate = days.find((d) => d.count > 0)?.date ?? days[0]?.date;

  let longest = { len: 0, start: null, end: null };
  let run = { len: 0, start: null, end: null };
  for (const d of days) {
    if (d.count > 0) {
      run = run.len ? { ...run, len: run.len + 1, end: d.date } : { len: 1, start: d.date, end: d.date };
      if (run.len > longest.len) longest = { ...run };
    } else run = { len: 0, start: null, end: null };
  }

  // Sequência atual: se hoje ainda não teve contribuição, conta até ontem.
  let i = days.length - 1;
  if (i >= 0 && days[i].count === 0) i--;
  const current = { len: 0, start: null, end: i >= 0 ? days[i].date : null };
  while (i >= 0 && days[i].count > 0) {
    current.len++;
    current.start = days[i].date;
    i--;
  }
  if (!current.len) current.end = null;

  return { total, firstDate, lastDate: days.at(-1)?.date, current, longest };
}

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
function fmt(date, withYear = true) {
  if (!date) return "";
  const [y, m, d] = date.split("-");
  return `${Number(d)} ${MESES[Number(m) - 1]}${withYear ? ` ${y}` : ""}`;
}
function range(start, end) {
  if (!start) return "—";
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  return start === end ? fmt(start) : `${fmt(start, !sameYear)} – ${fmt(end)}`;
}

const THEMES = {
  light: { text: "#1f2328", muted: "#59636e", accent: "#1a7f37", ring: "#2da44e", line: "#d0d7de" },
  dark: { text: "#e6edf3", muted: "#9198a1", accent: "#3fb950", ring: "#2ea043", line: "#30363d" },
};

export function renderSvg(s, theme) {
  const c = THEMES[theme];
  const font = `font-family="'Segoe UI', Ubuntu, 'Helvetica Neue', sans-serif"`;
  const col = (x, value, label, sub, color = c.text) => `
    <text x="${x}" y="88" text-anchor="middle" ${font} font-size="28" font-weight="700" fill="${color}">${value}</text>
    <text x="${x}" y="122" text-anchor="middle" ${font} font-size="13" font-weight="600" fill="${color}">${label}</text>
    <text x="${x}" y="144" text-anchor="middle" ${font} font-size="12" fill="${c.muted}">${sub}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="495" height="195" viewBox="0 0 495 195" role="img" aria-label="Sequência de contribuições">
  <rect width="495" height="195" rx="6" fill="none"/>
  <line x1="165" y1="40" x2="165" y2="155" stroke="${c.line}"/>
  <line x1="330" y1="40" x2="330" y2="155" stroke="${c.line}"/>
  <circle cx="247.5" cy="78" r="40" fill="none" stroke="${c.ring}" stroke-width="5"/>
  ${col(82.5, s.total.toLocaleString("pt-BR"), "Total de contribuições", range(s.firstDate, s.lastDate))}
  <text x="247.5" y="88" text-anchor="middle" ${font} font-size="28" font-weight="700" fill="${c.text}">${s.current.len}</text>
  <text x="247.5" y="146" text-anchor="middle" ${font} font-size="14" font-weight="700" fill="${c.accent}">Sequência atual</text>
  <text x="247.5" y="166" text-anchor="middle" ${font} font-size="12" fill="${c.muted}">${range(s.current.start, s.current.end)}</text>
  ${col(412.5, s.longest.len, "Maior sequência", range(s.longest.start, s.longest.end))}
</svg>
`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!token) throw new Error("Defina GITHUB_TOKEN");
  const stats = computeStats(await fetchDays());
  mkdirSync(outDir, { recursive: true });
  for (const theme of ["light", "dark"]) {
    const file = join(outDir, theme === "dark" ? "streak-dark.svg" : "streak.svg");
    writeFileSync(file, renderSvg(stats, theme));
    console.log(`Gerado ${file}`, stats);
  }
}
