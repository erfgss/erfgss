import * as fs from "node:fs";
import * as path from "node:path";
import { createEmptyGrid, setColor, type Color } from "./vendor/types/grid";
import { snake4 } from "./vendor/types/__fixtures__/snake";
import { getBestRoute } from "./vendor/solver/getBestRoute";
import { getPathToPose } from "./vendor/solver/getPathToPose";
import { createSvg, type DrawOptions } from "./vendor/svg-creator/index";

type Day = { date: string; count: number; level: number };
const root = path.resolve(__dirname, "..");
const snapshotPath = path.join(root, "github-calendar.json");
const levels = ["NONE", "FIRST_QUARTILE", "SECOND_QUARTILE", "THIRD_QUARTILE", "FOURTH_QUARTILE"];

async function main() {
  let days: Day[] = JSON.parse(fs.readFileSync(snapshotPath, "utf8").replace(/^\uFEFF/, ""));
  if (process.env.GITHUB_TOKEN) {
    const response = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `query($login:String!) { user(login:$login) { contributionsCollection { contributionCalendar { weeks { contributionDays { date contributionCount contributionLevel } } } } } }`,
        variables: { login: process.env.GITHUB_REPOSITORY_OWNER ?? "erfgss" },
      }),
    });
    if (!response.ok) throw new Error(`GitHub calendar request failed: ${response.status}`);
    const result = await response.json();
    if (result.errors?.length) throw new Error(JSON.stringify(result.errors));
    const known = new Map(days.map(day => [day.date, day]));
    // Repository tokens can see fewer contributions than the account owner.
    // Preserve the owner's known daily counts; never store credentials or repo details.
    days = result.data.user.contributionsCollection.contributionCalendar.weeks.flatMap(
      (week: any) => week.contributionDays.map((day: any): Day => {
        const previous = known.get(day.date);
        if (previous && previous.count > day.contributionCount) return previous;
        return { date: day.date, count: day.contributionCount, level: levels.indexOf(day.contributionLevel) };
      }),
    );
  }
  days.sort((a, b) => a.date.localeCompare(b.date));
  if (!days.length || days.some(day => !/^\d{4}-\d{2}-\d{2}$/.test(day.date) || day.count < 0 || day.level < 0 || day.level > 4)) {
    throw new Error("Invalid contribution calendar");
  }
  const first = new Date(`${days[0].date}T00:00:00Z`);
  const start = first.getTime() - first.getUTCDay() * 86400000;
  const cells = days.map(day => {
    const offset = Math.round((Date.parse(`${day.date}T00:00:00Z`) - start) / 86400000);
    return { ...day, x: Math.floor(offset / 7), y: offset % 7 };
  });
  const grid = createEmptyGrid(Math.max(...cells.map(cell => cell.x)) + 1, 7);
  for (const cell of cells) if (cell.level) setColor(grid, cell.x, cell.y, cell.level as Color);
  const route = getBestRoute(grid, snake4)!;
  route.push(...getPathToPose(route[route.length - 1], snake4)!);
  // Show the complete calendar for five seconds before the snake starts eating.
  const chain = [...Array(50).fill(route[0]), ...route];
  const palettes = {
    light: ["#ebedf0", "#ffe066", "#63e6be", "#74c0fc", "#b197fc"],
    dark: ["#161b22", "#d4a017", "#20c997", "#4dabf7", "#9775fa"],
  };
  fs.mkdirSync(path.join(root, "assets"), { recursive: true });
  for (const [theme, colors] of Object.entries(palettes)) {
    const options: DrawOptions = {
      colorEmpty: colors[0], colorDots: { 1: colors[1], 2: colors[2], 3: colors[3], 4: colors[4] } as DrawOptions["colorDots"],
      colorSnake: "#f97316", colorDotBorder: "#1b1f230a", sizeCell: 16, sizeDot: 12, sizeDotBorderRadius: 2,
    };
    const svg = createSvg(grid, cells, chain, options, { stepDurationMs: 100 });
    fs.writeFileSync(path.join(root, "assets", `github-colorful-complete${theme === "dark" ? "-dark" : ""}.svg`), svg);
  }
  fs.writeFileSync(snapshotPath, JSON.stringify(days, null, 2) + "\n");
  console.log(JSON.stringify({ total: days.reduce((sum, day) => sum + day.count, 0), activeDays: days.filter(day => day.count > 0).length, from: days[0].date, to: days[days.length - 1].date }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
