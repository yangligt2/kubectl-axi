/**
 * Typed views and projections for non-pod resources (deployments, nodes,
 * PVCs, services, endpoints), shared by triage and the per-resource
 * commands. Same philosophy as podstatus.ts: read `-o json`, project the
 * diagnostic signal, never scrape human-oriented output.
 */

export interface WorkloadCondition {
  type: string;
  status: string;
  reason?: string;
  message?: string;
}

export interface Deployment {
  metadata: { name: string; namespace?: string; creationTimestamp?: string };
  spec?: {
    replicas?: number;
    selector?: { matchLabels?: Record<string, string> };
    template?: {
      metadata?: { labels?: Record<string, string> };
      spec?: { containers?: Array<{ name: string; image?: string }> };
    };
  };
  status?: {
    replicas?: number;
    readyReplicas?: number;
    updatedReplicas?: number;
    availableReplicas?: number;
    conditions?: WorkloadCondition[];
  };
}

export interface DeploymentHealth {
  ready: string;
  healthy: boolean;
  /** Diagnostic reason when unhealthy, e.g. ProgressDeadlineExceeded. */
  reason: string;
}

export function deploymentHealth(deploy: Deployment): DeploymentHealth {
  const desired = deploy.spec?.replicas ?? 1;
  const ready = deploy.status?.readyReplicas ?? 0;
  const progressing = deploy.status?.conditions?.find(
    (c) => c.type === "Progressing",
  );
  const available = deploy.status?.conditions?.find(
    (c) => c.type === "Available",
  );

  // A rollout can be stuck while old replicas still serve (ready == desired),
  // so the Progressing condition is checked independently of the counts.
  const stuckRollout = progressing?.status === "False";
  const belowDesired = ready < desired;

  let reason = "OK";
  if (stuckRollout) {
    reason = progressing?.reason ?? "RolloutStuck";
  } else if (belowDesired) {
    reason = available?.status === "False"
      ? (available?.reason ?? "Unavailable")
      : "NotReady";
  }

  return {
    ready: `${ready}/${desired}`,
    healthy: !stuckRollout && !belowDesired,
    reason,
  };
}

export interface KubeNode {
  metadata: { name: string; creationTimestamp?: string };
  status?: {
    conditions?: WorkloadCondition[];
    capacity?: Record<string, string>;
    allocatable?: Record<string, string>;
    nodeInfo?: { kubeletVersion?: string };
  };
  spec?: {
    taints?: Array<{ key: string; value?: string; effect: string }>;
  };
}

export interface NodeIssue {
  condition: string;
  status: string;
  message: string;
}

/** Conditions that indicate trouble: Ready!=True, any *Pressure or NetworkUnavailable True. */
export function nodeIssues(node: KubeNode): NodeIssue[] {
  const issues: NodeIssue[] = [];
  for (const c of node.status?.conditions ?? []) {
    const bad =
      (c.type === "Ready" && c.status !== "True") ||
      (c.type !== "Ready" && c.status === "True");
    if (bad) {
      issues.push({
        condition: c.type,
        status: c.status,
        message: c.message ?? c.reason ?? "",
      });
    }
  }
  return issues;
}

export interface Pvc {
  metadata: { name: string; namespace?: string; creationTimestamp?: string };
  spec?: {
    storageClassName?: string;
    volumeName?: string;
    accessModes?: string[];
    resources?: { requests?: Record<string, string> };
  };
  status?: { phase?: string };
}

export function pvcPending(pvc: Pvc): boolean {
  return (pvc.status?.phase ?? "Pending") !== "Bound";
}

export interface Service {
  metadata: { name: string; namespace?: string };
  spec?: {
    type?: string;
    clusterIP?: string;
    selector?: Record<string, string>;
    ports?: Array<{ port: number; targetPort?: number | string; name?: string }>;
  };
}

export interface Endpoints {
  metadata: { name: string; namespace?: string };
  subsets?: Array<{
    addresses?: Array<{ ip: string; targetRef?: { name?: string } }>;
    notReadyAddresses?: Array<{ ip: string }>;
  }>;
}

export interface EndpointCounts {
  ready: number;
  notReady: number;
}

export function endpointCounts(ep: Endpoints | undefined): EndpointCounts {
  let ready = 0;
  let notReady = 0;
  for (const subset of ep?.subsets ?? []) {
    ready += subset.addresses?.length ?? 0;
    notReady += subset.notReadyAddresses?.length ?? 0;
  }
  return { ready, notReady };
}

/** Render a selector map as the kubectl -l expression, e.g. "app=web,tier=api". */
export function selectorExpression(
  selector: Record<string, string> | undefined,
): string | undefined {
  if (!selector || Object.keys(selector).length === 0) {
    return undefined;
  }
  return Object.entries(selector)
    .map(([key, value]) => `${key}=${value}`)
    .join(",");
}

/** Format service ports compactly: "80->8080/TCP" style without protocol noise. */
export function portSummary(service: Service): string {
  const ports = service.spec?.ports ?? [];
  if (ports.length === 0) {
    return "none";
  }
  return ports
    .map((p) =>
      p.targetPort !== undefined && `${p.targetPort}` !== `${p.port}`
        ? `${p.port}->${p.targetPort}`
        : `${p.port}`,
    )
    .join(",");
}
