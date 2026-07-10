import { cosineSim } from "../knowledge/vector";
import type { Voiceprint } from "./types";

// On-device diarization clustering. Standard streaming approach: online agglomerative
// clustering by cosine distance. Each voiceprint joins the nearest existing cluster if
// its similarity clears `threshold`, else it opens a new one; centroids are running
// means (re-normalized). A final merge pass folds clusters whose centroids are within
// threshold, cleaning up early over-splitting. Pure + deterministic (order-dependent,
// like real streaming diarization). Speaker count is discovered, not assumed — works for
// 2 parties or N.

export interface ClusterResult {
  /** Cluster id per input voiceprint (0-based, in first-seen order). */
  labels: number[];
  /** Unit-normalized centroid per cluster. */
  centroids: Voiceprint[];
  /** Number of voiceprints assigned to each cluster. */
  sizes: number[];
}

function addInto(target: Float64Array, v: Voiceprint): void {
  for (let i = 0; i < target.length; i++) target[i] += v[i];
}

function normalized(sum: Float64Array, count: number): Voiceprint {
  const out = new Float32Array(sum.length);
  let sq = 0;
  for (let i = 0; i < sum.length; i++) {
    const v = sum[i] / count;
    out[i] = v;
    sq += v * v;
  }
  const n = Math.sqrt(sq);
  if (n > 0) for (let i = 0; i < out.length; i++) out[i] /= n;
  return out;
}

/**
 * Cluster voiceprints into anonymous speakers. `threshold` is the min cosine to join an
 * existing cluster (higher = more, tighter clusters). `maxSpeakers` caps the count —
 * once reached, a stray voiceprint joins its nearest cluster regardless of threshold.
 */
export function clusterVoiceprints(
  vecs: Voiceprint[],
  threshold = 0.9,
  maxSpeakers = 6,
): ClusterResult {
  if (vecs.length === 0) return { labels: [], centroids: [], sizes: [] };
  const dim = vecs[0].length;
  const sums: Float64Array[] = [];
  const counts: number[] = [];
  const centroids: Voiceprint[] = [];
  const labels: number[] = new Array(vecs.length);

  for (let i = 0; i < vecs.length; i++) {
    const v = vecs[i];
    let best = -1;
    let bestSim = -Infinity;
    for (let c = 0; c < centroids.length; c++) {
      const sim = cosineSim(v, centroids[c]);
      if (sim > bestSim) {
        bestSim = sim;
        best = c;
      }
    }
    if (best >= 0 && (bestSim >= threshold || centroids.length >= maxSpeakers)) {
      addInto(sums[best], v);
      counts[best] += 1;
      centroids[best] = normalized(sums[best], counts[best]);
      labels[i] = best;
    } else {
      const sum = new Float64Array(dim);
      addInto(sum, v);
      sums.push(sum);
      counts.push(1);
      centroids.push(normalized(sum, 1));
      labels[i] = centroids.length - 1;
    }
  }

  return mergeClose({ labels, centroids, sizes: counts }, sums, threshold);
}

/** Fold clusters whose centroids are within `threshold`, then renumber compactly. */
function mergeClose(res: ClusterResult, sums: Float64Array[], threshold: number): ClusterResult {
  const k = res.centroids.length;
  const parent = Array.from({ length: k }, (_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  for (let a = 0; a < k; a++) {
    for (let b = a + 1; b < k; b++) {
      if (find(a) === find(b)) continue;
      if (cosineSim(res.centroids[a], res.centroids[b]) >= threshold) parent[find(b)] = find(a);
    }
  }
  // Compact remaining roots into 0-based ids in first-appearance order.
  const remap = new Map<number, number>();
  const labels = res.labels.map((l) => {
    const root = find(l);
    if (!remap.has(root)) remap.set(root, remap.size);
    return remap.get(root)!;
  });
  const groups = remap.size;
  const dim = res.centroids[0].length;
  const mSums = Array.from({ length: groups }, () => new Float64Array(dim));
  const mCounts = new Array(groups).fill(0);
  for (let c = 0; c < k; c++) {
    const g = remap.get(find(c));
    if (g === undefined) continue;
    for (let i = 0; i < dim; i++) mSums[g][i] += sums[c][i];
    mCounts[g] += res.sizes[c];
  }
  const centroids = mSums.map((s, g) => normalized(s, mCounts[g]));
  return { labels, centroids, sizes: mCounts };
}
