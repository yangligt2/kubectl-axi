export interface CommandPolicy {
  require_any_prefix?: string[];
  forbid_any_prefix?: string[];
}

export interface ConditionDef {
  id: string;
  name: string;
  tool: string;
  agents_md: string;
  mcp_config?: { mcpServers: Record<string, unknown> };
  command_policy?: CommandPolicy;
}

export interface TaskDef {
  id: string;
  category: string;
  prompt: string;
  grading?: { grading_hint?: string };
}

export type AgentBackend = "claude" | "gemini";

export interface RunSpec {
  condition: ConditionDef;
  task: TaskDef;
  run: number;
  agent: AgentBackend;
  model: string;
  kubeconfig: string;
}

export interface UsageMetrics {
  input_tokens: number;
  input_tokens_cached: number;
  output_tokens: number;
  total_cost_usd: number;
  wall_clock_seconds: number;
  turn_count: number;
  command_count: number;
  error_count: number;
  command_log: string[];
}

export interface GradeResult {
  task_success: boolean;
  details: string;
  failure_reason?:
    | "judge_error"
    | "judge_parse_error"
    | "policy_violation"
    | "task_failure";
  judge_model?: string;
}

export interface RunResult {
  condition: string;
  task: string;
  run: number;
  agent: AgentBackend;
  model: string;
  timestamp: string;
  usage: UsageMetrics;
  grade: GradeResult;
  agent_output: string;
}
