import * as Dijkstra from '../graphHelpers/Dijkstra'
import * as Blossom from "../graphHelpers/blossom";
import { UDGraph } from "./UDGraph";
import { findEularianTour, IEularianGraphEdge } from "../graphHelpers/EularianPath";


export function trySolveChinesePostmanProblem(udg: UDGraph): number[] {
  if (!udg) {
    throw Error("UDGraph required for solving Chinese Postman Problem!");
  }

  if (!udg.isFullyConnected()) {
    throw Error(`All ${udg.VertexCount} Vertices in Graph ${udg.Name} are not fully connected `);
  }

  const eularGraphEdges: IEularianGraphEdge[] = [];
  const oddVertexIds = udg.getOddDegreeVertices();
  if (oddVertexIds.length > 0) {
    console.warn(`Found ${oddVertexIds.length} odd-degree vertices (total ${udg.VertexCount}) from Graph ${udg.Name}`);

    // Compute shortest Path for all vertices in udg
    const shortestPathMap = udg.buildShortestPathMap();
    // console.log(shortestPathMap);

    // Build Graph with all odd-degree vertices and try finding minimum weight matching
    const oddGraphEdges: any[] = [];
    for (let oi = 0; oi < oddVertexIds.length; ++oi) {
      for (let oj = oi + 1; oj < oddVertexIds.length; ++oj) {
        // For each odd-degree vertex pair, add an edge for them (in the oddGraph) for blossom computing
        const vId1 = oddVertexIds[oi], vId2 = oddVertexIds[oj];
        const shortestPathWeight = shortestPathMap[vId1][vId2] as number;
        const reversedWeight = 1/shortestPathWeight * 1000;

        oddGraphEdges.push([oi, oj, reversedWeight]);
      }
    }

    const blossomResult = Blossom(oddGraphEdges) as number[];
    if (!blossomResult || blossomResult.length !== oddVertexIds.length) {
      throw Error(`Blossom maximum matching result size should be equal to odd-degree vertices count: ${oddVertexIds.length}`);
    }

    const processedVIdIndexSet = new Set<number>();
    blossomResult.forEach((pairVIdIndex, vIdIndex) => {
      if (!processedVIdIndexSet.has(vIdIndex)) {
        const vId = oddVertexIds[vIdIndex], pairVId = oddVertexIds[pairVIdIndex];
        const vIdsOfVirtualEdge = udg.getShortestPathVertexList(vId, pairVId);
        const virtualEdge: IEularianGraphEdge = {
          vId1: vId,
          vId2: pairVId,
          isDisabled: false,
          isVirtual: true,
          virtualVIds: vIdsOfVirtualEdge };
        eularGraphEdges.push(virtualEdge);

        processedVIdIndexSet.add(vIdIndex);
        processedVIdIndexSet.add(pairVIdIndex);
      }
    });

  }

  // add standard Edges(non-virtual) from original UDGraph into eularGraphEdges
  udg.Edges.forEach(e => {
    const eularEdge: IEularianGraphEdge = {
      vId1: e.v1Id,
      vId2: e.v2Id,
      isDisabled: false,
      isVirtual: false,
      virtualVIds: []
    };

    eularGraphEdges.push(eularEdge);
  });

   // console.debug(eularGraphEdges);

  const ep = findEularianTour(udg.getAllVertexIds(), eularGraphEdges);

  return ep;
}
