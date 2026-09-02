import { createHash } from "node:crypto";

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

export function generate4LeafMerkleReceipt(events) {
  // Pad or slice events to exactly 4 logical leaves for the "4-leaf balanced topology"
  // Each leaf hashes an event or a block of events.
  const leavesData = ["", "", "", ""];
  
  if (!events || events.length === 0) {
    // empty tree
  } else if (events.length <= 4) {
    events.forEach((e, i) => { leavesData[i] = JSON.stringify(e); });
  } else {
    // Chunk events into 4 buckets
    const chunkSize = Math.ceil(events.length / 4);
    for (let i = 0; i < 4; i++) {
       const chunk = events.slice(i * chunkSize, (i + 1) * chunkSize);
       leavesData[i] = JSON.stringify(chunk);
    }
  }

  const l0 = sha256(leavesData[0]);
  const l1 = sha256(leavesData[1]);
  const l2 = sha256(leavesData[2]);
  const l3 = sha256(leavesData[3]);

  // Intermediate nodes
  const n01 = sha256(l0 + l1);
  const n23 = sha256(l2 + l3);

  // Root
  const root = sha256(n01 + n23);

  return {
    root,
    topology: "quad_balanced",
    nodes: {
      intermediate: [n01, n23],
      leaves: [l0, l1, l2, l3]
    },
    // We optionally return the payload chunks that produced it so the visualizer can see it
    payloadChunks: leavesData
  };
}
