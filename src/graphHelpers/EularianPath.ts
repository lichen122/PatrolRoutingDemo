interface AdjListItem {
  targetVId: number;
  edgeIndex: number;
}

class EularianGraph {
  public vertices: Map<number, AdjListItem[]>;
  public edges: IEularianGraphEdge[];

  constructor(vertexIds: number[], edges: IEularianGraphEdge[]) {
    if (!vertexIds || vertexIds.length === 0) {
      throw Error("Invalid vertexIds!");
    }

    if (!edges || edges.length === 0) {
      throw Error("Invalid Edges!")
    }

    this.vertices = new Map<number, AdjListItem[]>();
    vertexIds.forEach(vId => {
      this.vertices.set(vId, []);
    });

    this.edges = edges.slice();
    this.edges.forEach((e,i) => {
      const vId1 = e.vId1, vId2 = e.vId2;
      const adjList1 = this.vertices.get(vId1);
      const adjList2 = this.vertices.get(vId2);

      adjList1?.push({
        targetVId: vId2,
        edgeIndex: i
      });

      adjList2?.push({
        targetVId: vId1,
        edgeIndex: i
      });

    });

  }

  public isValidNextEdge(srcVId: number, dstVId: number, edgeIndex: number): boolean {
    const adjListOfSrc = this.vertices.get(srcVId)?? [];

    // The edge u-v is valid in one of the
        // following two cases:

        // 1) If v is the only adjacent vertex of u
        // ie size of adjacent vertex list is 1
    let adjEdgesEnabled = 0;
    for (let adjItem of adjListOfSrc) {
      const adjEdge = this.edges[adjItem.edgeIndex];
      if (!adjEdge.isDisabled) {
        adjEdgesEnabled++;
      }
    }

    if (adjEdgesEnabled === 1) {
      return true;
    }

     // 2) If there are multiple adjacents, then
        // u-v is not a bridge Do following steps
        // to check if u-v is a bridge

    const count1 = this.bfsCount(srcVId);
    this.edges[edgeIndex].isDisabled = true;
    const count2 = this.bfsCount(srcVId);
    this.edges[edgeIndex].isDisabled = false;

    return count1 > count2? false : true;
  }

  public bfsCount(startVId: number) {

    const visitedVIds = new Set<number>();
    let curQueue = new Set<number>([startVId]);

    while (curQueue.size > 0) {
      let nextQueue = new Set<number>();
      for (let curVId of curQueue) {
        if (!visitedVIds.has(curVId)) {
          visitedVIds.add(curVId);
          var adjListOfCur = this.vertices.get(curVId) ?? [];

          for (let adjItem of adjListOfCur) {
            const targetVId = adjItem.targetVId;
            const adjEdge = this.edges[adjItem.edgeIndex];

            if (!adjEdge.isDisabled && !visitedVIds.has(targetVId)) {
              nextQueue.add(targetVId);
            }
          }
        }
      }

      curQueue.clear();
      curQueue = nextQueue;
    }

    return visitedVIds.size;
  }

  public _findEularRecursive(srcVId: number, eularPathEdges: IEularianGraphEdge[], eularPathVIds: number[]) {
    var adjListOfSrc = this.vertices.get(srcVId)?? [];

    for (let adjItem of adjListOfSrc) {
      const adjVId = adjItem.targetVId;
      const adjEdge = this.edges[adjItem.edgeIndex];
      if (!adjEdge.isDisabled && this.isValidNextEdge(srcVId, adjVId, adjItem.edgeIndex)) {
        // Add this adjEdge into Eular Path
        eularPathEdges.push(Object.assign({}, adjEdge));
        if (!adjEdge.isVirtual) {
          eularPathVIds.push(adjVId);
        } else {
          // Need to append the virtual path nodes into Eular path
          if (adjEdge.virtualVIds[0] === srcVId ) {
            eularPathVIds.push(...adjEdge.virtualVIds.slice(1));
          } else {
            eularPathVIds.push(...adjEdge.virtualVIds.slice(0, adjEdge.virtualVIds.length - 1).reverse());
          }
        }

        // Remove this adjEdge from graph(disable it) and continue finding
        adjEdge.isDisabled = true;
        this._findEularRecursive(adjVId, eularPathEdges, eularPathVIds);
      }
    }
  }

  public findEularPathOrCircle() : number[] {
    const allVertexIds = [... this.vertices.keys()];
    let startVId = allVertexIds[0];

    this.edges.forEach(e => e.isDisabled = false); // Reset the disable/remove status of each edge
    for (let vId of allVertexIds) {
      const adjList = this.vertices.get(vId)?? [];
      const degree = adjList.length;

      if (degree % 2 == 1) {
        // find odd-degree vertex, start from it
        startVId = vId;
        break;
      }
    }

    const eularEdges: IEularianGraphEdge[] = [];
    const eularVIds: number[] = [startVId];
    this._findEularRecursive(startVId, eularEdges, eularVIds);

    return eularVIds;
  }
}

export interface IEularianGraphEdge {
  vId1: number,
  vId2: number,
  isVirtual: boolean,
  virtualVIds: number[],
  isDisabled: boolean,
}

export function findEularianTour(vertexIds: number[], edges: IEularianGraphEdge[]): number[] {

  const epg = new EularianGraph(vertexIds, edges);

  return epg.findEularPathOrCircle();
}
