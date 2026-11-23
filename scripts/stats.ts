import { join } from 'node:path';

export interface Stats {
  since: number;
  contributions: number;
  heat: number[]; // contribution level 0-4 per day, oldest first
  languages: { name: string; percent: number }[];
}

type Level = 'NONE' | 'FIRST_QUARTILE' | 'SECOND_QUARTILE' | 'THIRD_QUARTILE' | 'FOURTH_QUARTILE';
interface Calendar {
  contributionCalendar: { totalContributions: number; weeks: { contributionDays: { date: string; contributionLevel: Level }[] }[] };
}
interface Repo {
  languages: { edges: { size: number; node: { name: string } }[] };
}
interface Data {
  user: { repositories: { nodes: Repo[] } } & Record<`y${number}`, Calendar>;
}

const USER = 'vastamaki';
const SINCE = 2018;
const HEAT_DAYS = 40;

const token = Bun.env.GITHUB_TOKEN || Bun.env.GH_TOKEN;
if (!token) throw new Error('GITHUB_TOKEN is not set');

async function graphql<T>(query: string): Promise<T> {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { authorization: `bearer ${token}`, 'content-type': 'application/json', 'user-agent': 'profile-stats' },
    body: JSON.stringify({ query }),
  });
  const body = (await res.json()) as { data: T; errors?: unknown };
  if (!res.ok || body.errors) throw new Error(`GitHub API error: ${JSON.stringify(body.errors ?? body)}`);
  return body.data;
}

// contributionsCollection covers at most one year, so ask for each year separately
const now = new Date();
const years: number[] = [];
for (let y = SINCE; y <= now.getUTCFullYear(); y++) years.push(y);
const calendars = years.map((y) => {
  const to = y === now.getUTCFullYear() ? now.toISOString() : `${y}-12-31T23:59:59Z`;
  return `y${y}: contributionsCollection(from: "${y}-01-01T00:00:00Z", to: "${to}") { contributionCalendar { totalContributions weeks { contributionDays { date contributionLevel } } } }`;
});

const data = await graphql<Data>(`{
  user(login: "${USER}") {
    ${calendars.join('\n    ')}
    repositories(first: 100, ownerAffiliations: OWNER, isFork: false, privacy: PUBLIC) {
      nodes { languages(first: 10, orderBy: { field: SIZE, direction: DESC }) { edges { size node { name } } } }
    }
  }
}`);

const calendar = (y: number) => data.user[`y${y}`].contributionCalendar;
const contributions = years.reduce((sum, y) => sum + calendar(y).totalContributions, 0);

const LEVEL: Record<Level, number> = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 };
const days = years.slice(-2).flatMap((y) => calendar(y).weeks.flatMap((w) => w.contributionDays));
const heat = days.sort((a, b) => a.date.localeCompare(b.date)).slice(-HEAT_DAYS).map((d) => LEVEL[d.contributionLevel]);

const bytes: Record<string, number> = {};
for (const repo of data.user.repositories.nodes) for (const { size, node } of repo.languages.edges) bytes[node.name] = (bytes[node.name] ?? 0) + size;
const total = Object.values(bytes).reduce((a, b) => a + b, 0);
const languages = Object.entries(bytes).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([name, size]) => ({ name, percent: Math.round((size / total) * 1000) / 10 }));

const stats: Stats = { since: SINCE, contributions, heat, languages };
await Bun.write(join(import.meta.dir, 'stats.json'), `${JSON.stringify(stats, null, 2)}\n`);
console.log(`${contributions} contributions since ${SINCE}; ${languages.map((l) => `${l.name} ${l.percent}%`).join(', ')}`);
