import { createHash } from "crypto";

export interface CelestiaConfig {
  /** celestia-node JSON-RPC endpoint, e.g. http://localhost:26658 */
  endpoint: string;
  /** Auth token from `celestia light auth admin --p2p.network mocha`. */
  authToken: string;
  /** 10-byte namespace ID for Iris, padded by celestia-node to 29 bytes. */
  namespace: Uint8Array;
}

export interface DaPointer {
  height: bigint;
  namespace: Uint8Array;
  commitment: Uint8Array;
}

/**
 * Minimal celestia-node JSON-RPC client. We deliberately keep this
 * dependency-free so the relayer can swap it for the official client
 * (https://www.npmjs.com/package/@celestiaorg/celestia-node-client) later.
 */
export class CelestiaPublisher {
  constructor(private readonly cfg: CelestiaConfig) {}

  /** The Iris namespace this publisher targets. */
  get namespace(): Uint8Array {
    return this.cfg.namespace;
  }

  /** Submit a blob and return the inclusion height + commitment. */
  async submitBlob(blob: Uint8Array): Promise<{ height: bigint; commitment: Uint8Array }> {
    const body = {
      id: 1,
      jsonrpc: "2.0",
      method: "blob.Submit",
      params: [
        [
          {
            namespace: Buffer.from(this.cfg.namespace).toString("base64"),
            data: Buffer.from(blob).toString("base64"),
            share_version: 0,
          },
        ],
        { gas_price: 0.002 },
      ],
    };
    const res = await fetch(this.cfg.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.cfg.authToken}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`celestia submit failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as { result?: number; error?: { message: string } };
    if (json.error) throw new Error(`celestia: ${json.error.message}`);
    const height = BigInt(json.result ?? 0);
    const commitment = blobCommitment(blob);
    return { height, commitment };
  }
}

export interface BatchInput {
  payloadHash: Uint8Array;
  receiptPda: Uint8Array;
}

export interface MerkleBatch {
  root: Uint8Array;
  leaves: Uint8Array[];
  blob: Uint8Array;
  count: number;
}

/**
 * Build a Merkle tree over receipt payload hashes. Uses SHA-256 with the
 * standard "duplicate last leaf if odd" rule. Replace with Solana's
 * `MerkleTree` from `@solana/spl-account-compression` if you want concurrent
 * Merkle trees later.
 */
export function buildBatch(inputs: BatchInput[]): MerkleBatch {
  if (inputs.length === 0) throw new Error("buildBatch: empty input");

  const leaves = inputs.map((i) => sha256(i.payloadHash));
  let layer = leaves.slice();
  while (layer.length > 1) {
    if (layer.length % 2 === 1) layer.push(layer[layer.length - 1]);
    const next: Uint8Array[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      next.push(sha256(concat(layer[i], layer[i + 1])));
    }
    layer = next;
  }
  const root = layer[0];

  // Blob format v0: [magic(4) | count(4 LE) | root(32) | for each receipt: payload_hash(32) | pda(32)]
  const blob = new Uint8Array(8 + 32 + inputs.length * 64);
  const view = new DataView(blob.buffer);
  blob.set([0x49, 0x52, 0x49, 0x53], 0); // 'IRIS'
  view.setUint32(4, inputs.length, true);
  blob.set(root, 8);
  let off = 40;
  for (const r of inputs) {
    blob.set(r.payloadHash, off); off += 32;
    blob.set(r.receiptPda, off); off += 32;
  }

  return { root, leaves, blob, count: inputs.length };
}

/** Pack a DaPointer into the 64-byte field stored on Solana. */
export function encodeDaPointer(p: DaPointer): Uint8Array {
  const out = new Uint8Array(64);
  const view = new DataView(out.buffer);
  view.setBigUint64(0, p.height, true);
  out.set(p.namespace.slice(0, 24), 8);   // 24-byte ns prefix
  out.set(p.commitment.slice(0, 32), 32); // 32-byte commitment
  return out;
}

function sha256(data: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(Buffer.from(data)).digest());
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function blobCommitment(blob: Uint8Array): Uint8Array {
  // celestia-node returns the commitment in its tx response; we synthesize
  // one for offline tests so MerkleBatch is self-contained.
  return sha256(blob);
}

export interface DaWorkerConfig {
  publisher: CelestiaPublisher;
  /** Flush when buffer hits this many receipts. */
  batchSize: number;
  /** Or after this many ms. */
  flushIntervalMs: number;
  /** Called with (root, daPointer, count) after each successful publish. */
  onRootReady: (root: Uint8Array, daPointer: Uint8Array, count: number) => Promise<void>;
}

/** Buffers receipts and publishes Merkle roots on a schedule. */
export class DaWorker {
  private buffer: BatchInput[] = [];
  private timer?: NodeJS.Timeout;

  constructor(private readonly cfg: DaWorkerConfig) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.flush().catch(console.error), this.cfg.flushIntervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  enqueue(r: BatchInput): void {
    this.buffer.push(r);
    if (this.buffer.length >= this.cfg.batchSize) {
      void this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const drained = this.buffer;
    this.buffer = [];
    const batch = buildBatch(drained);
    const { height, commitment } = await this.cfg.publisher.submitBlob(batch.blob);
    const pointer = encodeDaPointer({
      height,
      namespace: this.cfg.publisher.namespace,
      commitment,
    });
    await this.cfg.onRootReady(batch.root, pointer, batch.count);
  }
}
