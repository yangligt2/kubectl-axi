import { formatRelativeTime } from "./toon.js";

/**
 * Minimal typed views of the kubectl `get pods -o json` shape - only the
 * fields the projections read. Everything optional: real clusters omit
 * fields freely (no containerStatuses while Pending, etc.).
 */
export interface Probe {
  httpGet?: { path?: string; port?: number | string };
  tcpSocket?: { port?: number | string };
  exec?: { command?: string[] };
  grpc?: { port?: number };
}

export interface ContainerSpec {
  name: string;
  image?: string;
  readinessProbe?: Probe;
}

export interface ContainerState {
  running?: { startedAt?: string };
  waiting?: { reason?: string; message?: string };
  terminated?: { reason?: string; exitCode?: number; finishedAt?: string };
}

export interface ContainerStatus {
  name: string;
  ready?: boolean;
  restartCount?: number;
  image?: string;
  state?: ContainerState;
  lastState?: ContainerState;
}

export interface PodCondition {
  type: string;
  status: string;
  reason?: string;
  message?: string;
}

export interface Pod {
  metadata: {
    name: string;
    namespace?: string;
    creationTimestamp?: string;
    deletionTimestamp?: string;
  };
  spec?: {
    nodeName?: string;
    containers?: ContainerSpec[];
    initContainers?: ContainerSpec[];
  };
  status?: {
    phase?: string;
    conditions?: PodCondition[];
    containerStatuses?: ContainerStatus[];
    initContainerStatuses?: ContainerStatus[];
  };
}

/**
 * Compute a kubectl-style STATUS string, preferring the most diagnostic
 * signal: Terminating > Init:<reason> > waiting reason (CrashLoopBackOff,
 * ImagePullBackOff, ...) > Unschedulable > phase.
 */
export function podStatus(pod: Pod): string {
  if (pod.metadata.deletionTimestamp) {
    return "Terminating";
  }

  for (const s of pod.status?.initContainerStatuses ?? []) {
    const waiting = s.state?.waiting?.reason;
    if (waiting && waiting !== "PodInitializing") {
      return `Init:${waiting}`;
    }
    const terminated = s.state?.terminated;
    if (terminated && (terminated.exitCode ?? 0) !== 0) {
      return "Init:Error";
    }
  }

  for (const s of pod.status?.containerStatuses ?? []) {
    const waiting = s.state?.waiting?.reason;
    if (waiting) {
      return waiting;
    }
  }

  const phase = pod.status?.phase;
  if (phase === "Succeeded") {
    return "Completed";
  }
  if (phase === "Pending") {
    const scheduled = pod.status?.conditions?.find(
      (c) => c.type === "PodScheduled",
    );
    if (scheduled?.status === "False" && scheduled.reason === "Unschedulable") {
      return "Unschedulable";
    }
    return "Pending";
  }
  return phase ?? "Unknown";
}

/** Ready fraction, e.g. "1/2". */
export function podReady(pod: Pod): string {
  const total = pod.spec?.containers?.length ?? 0;
  const ready = (pod.status?.containerStatuses ?? []).filter(
    (s) => s.ready,
  ).length;
  return `${ready}/${total}`;
}

/** A pod counts as not-ready unless Completed, or Running with all containers ready. */
export function isNotReady(pod: Pod): boolean {
  const status = podStatus(pod);
  if (status === "Completed") {
    return false;
  }
  if (status !== "Running") {
    return true;
  }
  const total = pod.spec?.containers?.length ?? 0;
  const ready = (pod.status?.containerStatuses ?? []).filter(
    (s) => s.ready,
  ).length;
  return ready < total;
}

/** Total restarts across init and main containers. */
export function podRestarts(pod: Pod): number {
  const statuses = [
    ...(pod.status?.initContainerStatuses ?? []),
    ...(pod.status?.containerStatuses ?? []),
  ];
  return statuses.reduce((sum, s) => sum + (s.restartCount ?? 0), 0);
}

/** One-word-ish container state: running / waiting: X / terminated: X (exit N). */
export function containerStateString(status: ContainerStatus): string {
  const state = status.state;
  if (state?.running) {
    return "running";
  }
  if (state?.waiting) {
    return `waiting: ${state.waiting.reason ?? "unknown"}`;
  }
  if (state?.terminated) {
    const t = state.terminated;
    return `terminated: ${t.reason ?? "Error"} (exit ${t.exitCode ?? "?"})`;
  }
  return "unknown";
}

/** Last termination summary: "OOMKilled (exit 137, 2m ago)" or "none". */
export function lastStateString(status: ContainerStatus): string {
  const t = status.lastState?.terminated;
  if (!t) {
    return "none";
  }
  const when = t.finishedAt ? `, ${formatRelativeTime(t.finishedAt)}` : "";
  return `${t.reason ?? "Error"} (exit ${t.exitCode ?? "?"}${when})`;
}

/** Compact readiness probe summary: "http :8080/healthz", "tcp :5432", "exec", "none". */
export function probeSummary(spec: ContainerSpec | undefined): string {
  const probe = spec?.readinessProbe;
  if (!probe) {
    return "none";
  }
  if (probe.httpGet) {
    return `http :${probe.httpGet.port ?? "?"}${probe.httpGet.path ?? ""}`;
  }
  if (probe.tcpSocket) {
    return `tcp :${probe.tcpSocket.port ?? "?"}`;
  }
  if (probe.exec) {
    return "exec";
  }
  if (probe.grpc) {
    return `grpc :${probe.grpc.port ?? "?"}`;
  }
  return "none";
}
