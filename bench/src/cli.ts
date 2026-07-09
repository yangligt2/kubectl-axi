import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { precheck, runOne } from "./runner.js";
import { writeReports } from "./reporter.js";
import type { AgentBackend, ConditionDef, TaskDef } from "./types.js";

const BENCH_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = join(BENCH_ROOT, "..");
const RESULTS_DIR = join(BENCH_ROOT, "results");
const DEFAULT_MODEL: Record<AgentBackend, string> = {
  claude: "claude-sonnet-4-6",
  gemini: "gemini-3.5-flash",
};
const DEFAULT_REPEAT = 1;

/** Load KEY=VALUE lines from the repo's .env.local (e.g. GEMINI_API_KEY)
 * without overriding anything already set in the environment. */
function loadEnvLocal(): void {
  const file = join(REPO_ROOT, ".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function loadConditions(): Map<string, ConditionDef> {
  const raw = parse(readFileSync(join(BENCH_ROOT, "conditions.yaml"), "utf-8"));
  const map = new Map<string, ConditionDef>();
  for (const [id, def] of Object.entries(raw.conditions as Record<string, Omit<ConditionDef, "id">>)) {
    map.set(id, { ...def, id });
  }
  return map;
}

function loadTasks(): Map<string, TaskDef> {
  const raw = parse(readFileSync(join(BENCH_ROOT, "tasks.yaml"), "utf-8"));
  const map = new Map<string, TaskDef>();
  for (const [id, def] of Object.entries(raw.tasks as Record<string, Omit<TaskDef, "id">>)) {
    map.set(id, { ...def, id });
  }
  return map;
}

function resolveKubeconfig(): string {
  const explicit = process.env.BENCH_KUBECONFIG;
  if (explicit) return explicit;
  const local = join(BENCH_ROOT, "..", ".kube", "config");
  if (existsSync(local)) return local;
  throw new Error(
    "No kubeconfig for the fixture cluster: run `make remote-up` (or `make cluster-up`) first, or set BENCH_KUBECONFIG",
  );
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
      args[key] = argv[i + 1];
      i++;
    } else {
      args[key] = "true";
    }
  }
  return args;
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function pick<T>(map: Map<string, T>, ids: string | undefined, label: string): T[] {
  if (!ids) return [...map.values()];
  return ids.split(",").map((id) => {
    const value = map.get(id.trim());
    if (!value) {
      throw new Error(`Unknown ${label}: ${id} (known: ${[...map.keys()].join(", ")})`);
    }
    return value;
  });
}

function executeRuns(
  conditions: ConditionDef[],
  tasks: TaskDef[],
  repeat: number,
  model: string,
  agent: AgentBackend,
): void {
  loadEnvLocal();
  if (agent === "gemini" && !process.env.GEMINI_API_KEY) {
    throw new Error(
      "GEMINI_API_KEY is not set (put it in .env.local or the environment) for --agent gemini",
    );
  }
  const kubeconfig = resolveKubeconfig();
  const needsAxi = conditions.some((c) => c.tool === "kubectl-axi");
  precheck(kubeconfig, needsAxi);

  const total = conditions.length * tasks.length * repeat;
  let done = 0;
  for (const condition of shuffle(conditions)) {
    for (const task of shuffle(tasks)) {
      for (let run = 1; run <= repeat; run++) {
        done++;
        console.log(`[${done}/${total}] ${agent} ${condition.id} × ${task.id} run${run}`);
        const result = runOne(
          { condition, task, run, model, agent, kubeconfig },
          RESULTS_DIR,
        );
        console.log(
          `  ${result.grade.task_success ? "PASS" : `FAIL (${result.grade.failure_reason})`}` +
            ` cost=$${result.usage.total_cost_usd.toFixed(3)}` +
            ` turns=${result.usage.turn_count}` +
            ` ${result.usage.wall_clock_seconds.toFixed(1)}s`,
        );
      }
    }
  }
}

const [command, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);

switch (command) {
  case "run": {
    if (!args.condition || !args.task) {
      console.error("usage: bench run --condition <id> --task <id> [--repeat N] [--agent claude|gemini] [--model M]");
      process.exit(2);
    }
    const agent = (args.agent ?? "claude") as AgentBackend;
    const conditions = pick(loadConditions(), args.condition, "condition");
    const tasks = pick(loadTasks(), args.task, "task");
    executeRuns(conditions, tasks, Number(args.repeat ?? DEFAULT_REPEAT), args.model ?? DEFAULT_MODEL[agent], agent);
    break;
  }
  case "matrix": {
    const agent = (args.agent ?? "claude") as AgentBackend;
    const conditions = pick(loadConditions(), args.condition, "condition");
    const tasks = pick(loadTasks(), args.task, "task");
    executeRuns(conditions, tasks, Number(args.repeat ?? DEFAULT_REPEAT), args.model ?? DEFAULT_MODEL[agent], agent);
    console.log(writeReports(RESULTS_DIR));
    break;
  }
  case "report": {
    console.log(writeReports(RESULTS_DIR));
    break;
  }
  default:
    console.error(`usage: bench <run|matrix|report>
  run    --condition <id[,id]> --task <id[,id]> [--repeat N] [--agent claude|gemini] [--model M]
  matrix [--condition <id[,id]>] [--task <id[,id]>] [--repeat N] [--agent claude|gemini] [--model M]
  report`);
    process.exit(2);
}
