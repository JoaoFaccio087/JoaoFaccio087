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

// Mesmas cores dos temas "default" e "github_dark" do github-readme-stats,
// para o card combinar com os de stats e linguagens.
const THEMES = {
  light: { title: "#2f80ed", text: "#434d58", muted: "#6e7781", ring: "#2f80ed", line: "#d0d7de" },
  dark: { title: "#58a6ff", text: "#c3d1d9", muted: "#8b949e", ring: "#58a6ff", line: "#30363d" },
};

// Largura = dois cards de 400px lado a lado + o espaço entre eles no README.
export const WIDTH = 804;
const HEIGHT = 195;

export function renderSvg(s, theme) {
  const c = THEMES[theme];
  const font = `font-family="'Segoe UI', Ubuntu, 'Helvetica Neue', Sans-Serif"`;
  const colW = WIDTH / 3;
  const x = (i) => colW * i + colW / 2;
  const side = (cx, value, label, sub) => `
  <text x="${cx}" y="112" text-anchor="middle" ${font} font-size="28" font-weight="700" fill="${c.text}">${value}</text>
  <text x="${cx}" y="142" text-anchor="middle" ${font} font-size="14" font-weight="600" fill="${c.text}">${label}</text>
  <text x="${cx}" y="164" text-anchor="middle" ${font} font-size="12" fill="${c.muted}">${sub}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" fill="none" role="img" aria-label="Sequência de contribuições">
  <text x="25" y="35" ${font} font-size="18" font-weight="600" fill="${c.title}">Sequência de contribuições</text>
  <line x1="${colW}" y1="62" x2="${colW}" y2="172" stroke="${c.line}"/>
  <line x1="${colW * 2}" y1="62" x2="${colW * 2}" y2="172" stroke="${c.line}"/>${side(x(0), s.total.toLocaleString("pt-BR"), "Total de contribuições", range(s.firstDate, s.lastDate))}
  <circle cx="${x(1)}" cy="102" r="34" stroke="${c.ring}" stroke-width="5"/>
  <text x="${x(1)}" y="112" text-anchor="middle" ${font} font-size="28" font-weight="700" fill="${c.text}">${s.current.len}</text>
  <text x="${x(1)}" y="160" text-anchor="middle" ${font} font-size="14" font-weight="700" fill="${c.ring}">Sequência atual</text>
  <text x="${x(1)}" y="180" text-anchor="middle" ${font} font-size="12" fill="${c.muted}">${range(s.current.start, s.current.end)}</text>${side(x(2), s.longest.len, "Maior sequência", range(s.longest.start, s.longest.end))}
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
