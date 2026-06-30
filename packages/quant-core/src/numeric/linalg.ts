/* =============================================================================
 * quant-core / numeric / linalg
 * -----------------------------------------------------------------------------
 * Dense small-matrix linear algebra, specialised for covariance work. Matrices
 * are row-major Float64Array views wrapped in a thin {rows, cols, data} record
 * so we never pay the cost of nested-array pointer chasing in hot loops.
 *
 * The centrepiece is `cholesky`, which factors a covariance matrix Σ = L Lᵀ.
 * Multiplying i.i.d. standard normals z by L yields draws with covariance Σ —
 * this is how the Monte-Carlo engine injects cross-asset correlation. We also
 * ship a "nearest correlation" projection (Higham 2002) because empirically
 * estimated correlation matrices are routinely *not* positive semidefinite and
 * a naïve Cholesky on them simply throws.
 * ===========================================================================*/

export interface Mat {
  readonly rows: number;
  readonly cols: number;
  readonly data: Float64Array; // row-major, length rows*cols
}

export const at = (m: Mat, i: number, j: number): number => m.data[i * m.cols + j];
export const set = (m: Mat, i: number, j: number, v: number): void => {
  m.data[i * m.cols + j] = v;
};

export function zeros(rows: number, cols: number): Mat {
  return { rows, cols, data: new Float64Array(rows * cols) };
}

export function identity(n: number): Mat {
  const m = zeros(n, n);
  for (let i = 0; i < n; i++) set(m, i, i, 1);
  return m;
}

/** Build a Mat from a nested array, validating rectangularity. */
export function fromRows(rows: number[][]): Mat {
  const r = rows.length;
  const c = rows[0]?.length ?? 0;
  const data = new Float64Array(r * c);
  for (let i = 0; i < r; i++) {
    if (rows[i].length !== c) throw new Error(`row ${i} is ragged (${rows[i].length} ≠ ${c})`);
    for (let j = 0; j < c; j++) data[i * c + j] = rows[i][j];
  }
  return { rows: r, cols: c, data };
}

export function toRows(m: Mat): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < m.rows; i++) {
    const row: number[] = [];
    for (let j = 0; j < m.cols; j++) row.push(at(m, i, j));
    out.push(row);
  }
  return out;
}

/** Matrix-vector product M·v. */
export function matVec(m: Mat, v: ArrayLike<number>): Float64Array {
  if (v.length !== m.cols) throw new Error(`dim mismatch ${m.cols} ≠ ${v.length}`);
  const out = new Float64Array(m.rows);
  for (let i = 0; i < m.rows; i++) {
    let s = 0;
    const base = i * m.cols;
    for (let j = 0; j < m.cols; j++) s += m.data[base + j] * v[j];
    out[i] = s;
  }
  return out;
}

/** Symmetric quadratic form xᵀ M x. */
export function quadForm(m: Mat, x: ArrayLike<number>): number {
  const mx = matVec(m, x);
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * mx[i];
  return s;
}

/**
 * Cholesky factorisation of a symmetric positive-definite matrix A = L Lᵀ,
 * returning the lower-triangular L. Throws if A is not positive definite —
 * caller should pre-condition with `nearestCorrelation` if the input is an
 * estimated (and possibly indefinite) correlation/covariance matrix.
 *
 * Classic column-wise Cholesky–Banachiewicz; O(n³/3), which is irrelevant at
 * the basket sizes we run (n ≤ ~64).
 */
export function cholesky(a: Mat): Mat {
  const n = a.rows;
  if (a.cols !== n) throw new Error("cholesky: matrix must be square");
  const L = zeros(n, n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = at(a, i, j);
      for (let k = 0; k < j; k++) sum -= at(L, i, k) * at(L, j, k);
      if (i === j) {
        if (sum <= 0) throw new Error(`cholesky: not positive definite at pivot ${i} (got ${sum})`);
        set(L, i, j, Math.sqrt(sum));
      } else {
        set(L, i, j, sum / at(L, j, j));
      }
    }
  }
  return L;
}

/** Convert a covariance matrix into its correlation matrix + the stdev vector. */
export function covToCorr(cov: Mat): { corr: Mat; sigma: Float64Array } {
  const n = cov.rows;
  const sigma = new Float64Array(n);
  for (let i = 0; i < n; i++) sigma[i] = Math.sqrt(at(cov, i, i));
  const corr = zeros(n, n);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const denom = sigma[i] * sigma[j];
      set(corr, i, j, denom > 0 ? at(cov, i, j) / denom : i === j ? 1 : 0);
    }
  return { corr, sigma };
}

/** Reconstitute a covariance matrix from a correlation matrix and stdev vector. */
export function corrToCov(corr: Mat, sigma: ArrayLike<number>): Mat {
  const n = corr.rows;
  const cov = zeros(n, n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) set(cov, i, j, at(corr, i, j) * sigma[i] * sigma[j]);
  return cov;
}

/* ---------------------------------------------------------------------------
 * Symmetric eigendecomposition via the cyclic Jacobi rotation method. Slow on
 * paper (O(n³) per sweep, several sweeps) but unconditionally stable and dead
 * simple to verify — exactly what we want for the Higham projection below,
 * where robustness beats raw speed.
 * ------------------------------------------------------------------------- */
export function jacobiEigenSym(a: Mat, maxSweeps = 100, tol = 1e-12): { values: Float64Array; vectors: Mat } {
  const n = a.rows;
  const A = new Float64Array(a.data); // working copy, mutated in place
  const V = identity(n).data;
  const aAt = (i: number, j: number) => A[i * n + j];
  const aSet = (i: number, j: number, v: number) => {
    A[i * n + j] = v;
  };
  const vAt = (i: number, j: number) => V[i * n + j];
  const vSet = (i: number, j: number, v: number) => {
    V[i * n + j] = v;
  };

  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += aAt(p, q) * aAt(p, q);
    if (Math.sqrt(off) < tol) break;

    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = aAt(p, q);
        if (Math.abs(apq) < tol) continue;
        const app = aAt(p, p);
        const aqq = aAt(q, q);
        const phi = 0.5 * Math.atan2(2 * apq, aqq - app);
        const c = Math.cos(phi);
        const s = Math.sin(phi);
        for (let k = 0; k < n; k++) {
          const akp = aAt(k, p);
          const akq = aAt(k, q);
          aSet(k, p, c * akp - s * akq);
          aSet(k, q, s * akp + c * akq);
        }
        for (let k = 0; k < n; k++) {
          const apk = aAt(p, k);
          const aqk = aAt(q, k);
          aSet(p, k, c * apk - s * aqk);
          aSet(q, k, s * apk + c * aqk);
        }
        for (let k = 0; k < n; k++) {
          const vkp = vAt(k, p);
          const vkq = vAt(k, q);
          vSet(k, p, c * vkp - s * vkq);
          vSet(k, q, s * vkp + c * vkq);
        }
      }
    }
  }
  const values = new Float64Array(n);
  for (let i = 0; i < n; i++) values[i] = A[i * n + i];
  return { values, vectors: { rows: n, cols: n, data: V } };
}

/**
 * Higham (2002) nearest-correlation-matrix projection, simplified to the single
 * spectral projection that clips negative eigenvalues to a small floor and
 * renormalises the diagonal to 1. This is the workhorse pre-conditioner: feed
 * it a noisy empirical correlation matrix and it returns the closest valid
 * (positive-semidefinite, unit-diagonal) matrix that Cholesky will accept.
 */
export function nearestCorrelation(corr: Mat, eigFloor = 1e-8): Mat {
  const n = corr.rows;
  const { values, vectors } = jacobiEigenSym(corr);
  // Rebuild  Σ⁺ = V · max(Λ, floor) · Vᵀ
  const clipped = zeros(n, n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let k = 0; k < n; k++) {
        const lam = Math.max(values[k], eigFloor);
        s += at(vectors, i, k) * lam * at(vectors, j, k);
      }
      set(clipped, i, j, s);
    }
  }
  // Renormalise to unit diagonal so it is a genuine correlation matrix again.
  const d = new Float64Array(n);
  for (let i = 0; i < n; i++) d[i] = Math.sqrt(at(clipped, i, i));
  const out = zeros(n, n);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const v = at(clipped, i, j) / (d[i] * d[j]);
      set(out, i, j, i === j ? 1 : v);
    }
  return out;
}

/**
 * Robust covariance Cholesky: try the direct factorisation; if the matrix is
 * not positive definite (common with estimated data), fall back to projecting
 * the correlation matrix to the nearest valid one and refactoring. Returns the
 * lower factor L such that L Lᵀ ≈ cov.
 */
export function safeCovCholesky(cov: Mat): Mat {
  try {
    return cholesky(cov);
  } catch {
    const { corr, sigma } = covToCorr(cov);
    const fixed = nearestCorrelation(corr);
    return cholesky(corrToCov(fixed, sigma));
  }
}

/* ---------------------------------------------------------------------------
 * SPD linear solves via the Cholesky factor. Covariance matrices are symmetric
 * positive-definite, so Σx = b and Σ⁻¹ are obtained by a forward + back solve
 * against L (no general LU needed). Used by the portfolio optimiser to evaluate
 * Σ⁻¹μ and Σ⁻¹1 — the building blocks of mean-variance weights.
 * ------------------------------------------------------------------------- */

/** Solve L y = b for lower-triangular L (forward substitution). */
export function forwardSolve(L: Mat, b: ArrayLike<number>): Float64Array {
  const n = L.rows;
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let j = 0; j < i; j++) s -= at(L, i, j) * y[j];
    y[i] = s / at(L, i, i);
  }
  return y;
}

/** Solve Lᵀ x = y for lower-triangular L (back substitution on Lᵀ). */
export function backSolveTranspose(L: Mat, y: ArrayLike<number>): Float64Array {
  const n = L.rows;
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let j = i + 1; j < n; j++) s -= at(L, j, i) * x[j];
    x[i] = s / at(L, i, i);
  }
  return x;
}

/** Solve A x = b given the Cholesky factor L of A = L Lᵀ. */
export function choleskySolve(L: Mat, b: ArrayLike<number>): Float64Array {
  return backSolveTranspose(L, forwardSolve(L, b));
}

/** Solve A x = b for symmetric positive-definite A. */
export function solveSPD(a: Mat, b: ArrayLike<number>): Float64Array {
  return choleskySolve(cholesky(a), b);
}

/** Transpose. */
export function transpose(m: Mat): Mat {
  const out = zeros(m.cols, m.rows);
  for (let i = 0; i < m.rows; i++) for (let j = 0; j < m.cols; j++) set(out, j, i, at(m, i, j));
  return out;
}

/** Dense matrix product A·B. */
export function matMul(a: Mat, b: Mat): Mat {
  if (a.cols !== b.rows) throw new Error(`matMul dim mismatch ${a.cols} ≠ ${b.rows}`);
  const out = zeros(a.rows, b.cols);
  for (let i = 0; i < a.rows; i++)
    for (let k = 0; k < a.cols; k++) {
      const aik = at(a, i, k);
      if (aik === 0) continue;
      for (let j = 0; j < b.cols; j++) out.data[i * b.cols + j] += aik * at(b, k, j);
    }
  return out;
}

/** Inverse of a symmetric positive-definite matrix (column-by-column solve). */
export function invSPD(a: Mat): Mat {
  const n = a.rows;
  const L = cholesky(a);
  const inv = zeros(n, n);
  const e = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    e.fill(0);
    e[k] = 1;
    const col = choleskySolve(L, e);
    for (let i = 0; i < n; i++) set(inv, i, k, col[i]);
  }
  return inv;
}
