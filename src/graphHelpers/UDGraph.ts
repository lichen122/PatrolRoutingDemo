import Point from "@arcgis/core/geometry/Point";
import * as Dijkstra from '../graphHelpers/Dijkstra'
import { zone1VertexPoints, zone1Edges } from "../mapData/AlbanyStreetsGraphs";

export interface IGraphEdge {
  v1Id: number;
  v2Id: number;
  weight: number;
}

export interface IUDGraphAdjVertexDict {
  [id: number]: number;
}

export class UDGraphVertex {
  public _id: number;
  public _label: string;
  public _degree: number;
  public _point: Point;
  public _adjVertexDict: IUDGraphAdjVertexDict;

  constructor(vId: number, label: string, pt: Point) {
    this._id = vId;
    this._label = label;
    this._point = pt;
    this._degree = 0;
    this._adjVertexDict = {};
  }

  public get Id(): number {
    return this._id;
  }

  public get Label(): string {
    return this._label;
  }

  public get Degree(): number {
    return this._degree;
  }

  public get Point(): Point {
    return this._point;
  }

  public isAdjTo(targetVId: number): boolean {
    if (typeof(targetVId) !== "number" || !targetVId) {
      return false;
    }

    return targetVId in this._adjVertexDict;
  }

  public getAllAdjVertexIds(): number[] {
    const adjVIds = Object.getOwnPropertyNames(this._adjVertexDict).map(pn => parseInt(pn));
    return adjVIds;
  }

  public addEdge(targetVId: number, weight: number) {
    if (typeof(targetVId) !== "number" || !targetVId || targetVId === this.Id) {
      throw Error(`Invalid AdjVertex Id: ${targetVId}`);
    }

    if (targetVId in this._adjVertexDict) {
      throw Error(`Edge to Vertex ${targetVId} already exists.`);
    }

    this._adjVertexDict[targetVId] = weight;
    this._degree++;
  }
}

export interface IUDGraphVertexDict {
  [id: number]: UDGraphVertex;
}

export class UDGraph {
  private _name: string;
  private _vertexCount: number;
  private _vertexDict: IUDGraphVertexDict;
  private _edges: IGraphEdge[];

  constructor(name: string) {
    this._name = name;
    this._vertexCount = 0;
    this._vertexDict = {};
    this._edges = [];
  }

  public get Name(): string {
    return this._name;
  }

  public get VertexCount(): number {
    return this._vertexCount;
  }

  public get Edges(): IGraphEdge[] {
    return this._edges.slice();
  }

  public getAllVertexIds(): number[] {
    const vIds = Object.getOwnPropertyNames(this._vertexDict).map(pn => parseInt(pn));
    return vIds;
  }

  public getOddDegreeVertices(): number[] {
    const odVertexIds: number[] = [];

    for (let pn in this._vertexDict) {
      const vId = parseInt(pn);
      const v = this._vertexDict[vId];
      if (v.Degree %2 === 1) {
        odVertexIds.push(vId);
      }
    }

    return odVertexIds;
  }

  public getVertex(id: number): UDGraphVertex {
    return this._vertexDict[id];
  }

  public addVertex(id: number, label: string, pt: Point): void {
    if (!!this._vertexDict[id]) {
      console.warn(`Vertex: ${id} already exists.`);
      return;
    }

    const vertex = new UDGraphVertex(id, label, pt);
    this._vertexDict[id] = vertex;
    this._vertexCount++;
  }

  public getEdgeIndex(v1Id: number, v2Id: number): number {

    if (typeof(v1Id) !== "number") {
      v1Id = parseInt(v1Id);
    }

    if (typeof(v2Id) !== "number") {
      v2Id = parseInt(v2Id);
    }

    let edgeIndex = -1;
    for (let i = 0; i < this.Edges.length; ++i) {
      const edge = this.Edges[i];
      if ((edge.v1Id === v1Id && edge.v2Id === v2Id) || (edge.v1Id === v2Id && edge.v2Id === v1Id)) {
        edgeIndex = i;
        break;
      }
    }

    if (edgeIndex === -1) {
      console.warn(`Edge (${v1Id}, ${v2Id}) not found in Graph`);
    }
    return edgeIndex;
  }

  public addEdge(v1Id: number, v2Id: number, weight: number): void {
    const v1 = this.getVertex(v1Id);
    const v2 = this.getVertex(v2Id);
    if (!v1 || !v2) {
      throw Error(`Invalid Edge Vertex Ids: (${v1Id}, ${v2Id})`);
    }

    v1.addEdge(v2.Id, weight);
    v2.addEdge(v1.Id, weight);

    const graphEdge: IGraphEdge = {
      v1Id: v1.Id,
      v2Id: v2.Id,
      weight: weight,
    };

    this._edges.push(graphEdge);
  }

  /**
   * Perform a BFS traverse over graph
   * @param vertexVisitCallback
   * @returns
   */
  public bfsTraverse(vertexVisitCallback: (v: UDGraphVertex, i: number) => void): number {
    if (this.VertexCount === 0) {
      console.log(`Graph ${this.Name} is empty.`);
      return 0;
    }

    const n = this.VertexCount;
    let connectedGroups = 0;
    const vertexIds = this.getAllVertexIds();
    const visitedIdSet: Set<number> = new Set<number>();
    let visitedIndex: number = 0;

    for (let i = 0; i< n; ++i) {
      const vId = vertexIds[i];
      if (!visitedIdSet.has(vId)) {
        let curQueue: Set<number> = new Set<number>([vId]);
        while (curQueue.size > 0) {
          let nextQueue: Set<number> = new Set();

          for (let curVId of curQueue) {
            if (!visitedIdSet.has(curVId)) {
              const vtx = this.getVertex(curVId);
              if (vertexVisitCallback !== undefined) {
                try {
                  vertexVisitCallback(vtx, visitedIndex);
                } catch (err) {
                  console.error(err);
                }
              }

              visitedIdSet.add(curVId);
              ++visitedIndex;

              const adjVertexIds = vtx.getAllAdjVertexIds();
              for (let adjVId of adjVertexIds) {
                if (!visitedIdSet.has(adjVId)) {
                  nextQueue.add(adjVId);
                }
              }
            }
          }

          curQueue.clear();
          curQueue = nextQueue;
        }

        ++connectedGroups;
      }
    }

    return connectedGroups;
  }

  private calcOddDegreeVertexCountByEdges(edgeIndices: Set<number>): number {
    const self = this;
    let odCount = 0;
    const degreeMap = new Map<number, number>();
    edgeIndices.forEach(edgeIndex => {
      const e = self.Edges[edgeIndex];
      if (!degreeMap.has(e.v1Id)) {
        degreeMap.set(e.v1Id, 0);
      }
      if (!degreeMap.has(e.v2Id)) {
        degreeMap.set(e.v2Id, 0);
      }

      const prevCount1 = degreeMap.get(e.v1Id)?? 0;
      degreeMap.set(e.v1Id, prevCount1 + 1);

      const prevCount2 = degreeMap.get(e.v2Id)?? 0;
      degreeMap.set(e.v2Id, prevCount2 + 1);

    });

    degreeMap.forEach((v, k) => {
      if (v %2 === 1) {
        odCount++;
      }
    });

    return odCount;
  }

  public expandSubGraphFromVertexWithDegreeCheck(srcVId: number, disabledEdgeIndices: Set<number>, maxEdges: number = 10): UDGraph {
    const self = this;
    const srcVertex = this.getVertex(srcVId);

    if (!srcVertex) {
      throw Error(`Vertex ${srcVId} not found in Graph: ${this.Name}`);
    }

    const maxDepth = 3;
    const visitedVIds = new Set<number>();
    const includedEdgeIndices = new Set<number>();
    const queue: number[] = [srcVId];
    let foundResult = false;

    while (queue.length > 0) {
      const curVId: number = queue.shift()?? 0;
      if (!curVId) {
        throw Error(`Invalid curVId during BFS of Graph ${this.Name}`);
      }

      if (!visitedVIds.has(curVId)) {
        visitedVIds.add(curVId);

        const adjVIds = this.getVertex(curVId).getAllAdjVertexIds();
        const nextVIds = new Set<number>();
        for (let adjVId of adjVIds) {
          const adjEdgeIndex = this.getEdgeIndex(curVId, adjVId);
          // if (!visitedVIds.has(adjVId) && !includedEdgeIndices.has(adjEdgeIndex)
          if (!includedEdgeIndices.has(adjEdgeIndex) && !disabledEdgeIndices.has(adjEdgeIndex) && includedEdgeIndices.size < maxEdges) {
            nextVIds.add(adjVId);
            includedEdgeIndices.add(adjEdgeIndex);

            // If current degree is 0
            const curOddDegreee = self.calcOddDegreeVertexCountByEdges(includedEdgeIndices);
            if (curOddDegreee === 0 || curOddDegreee === 2 && includedEdgeIndices.size >= 3) {
              foundResult = true;
            }
          }

          if (foundResult) {
            break;
          }
        }

        if (foundResult) {
          break;
        }

        if (nextVIds.size > 0) {
          queue.push(... nextVIds);
        }
      }
    }

    const subGraph = new UDGraph("Expanding SubGraph");
    const vIdSetOfSubGraph = new Set<number>();
    includedEdgeIndices.forEach(edgeIndex => {
      const e = self.Edges[edgeIndex];
      vIdSetOfSubGraph.add(e.v1Id);
      vIdSetOfSubGraph.add(e.v2Id);
    });

    vIdSetOfSubGraph.forEach(vId => {
      const vtx = this.getVertex(vId);
      subGraph.addVertex(vtx.Id, vtx.Label, vtx.Point);
    });

    includedEdgeIndices.forEach(edgeIndex => {
      const e = this.Edges[edgeIndex];
      subGraph.addEdge(e.v1Id, e.v2Id, e.weight);
    });

    return subGraph;
  }

  // public expandSubGraphFromVertex(srcVId: number, disabledEdgeIndices: Set<number>, maxEdges: number = 10): UDGraph {
  //   const srcVertex = this.getVertex(srcVId);

  //   if (!srcVertex) {
  //     throw Error(`Vertex ${srcVId} not found in Graph: ${this.Name}`);
  //   }

  //   const maxDepth = 3;
  //   const visitedVIds = new Set<number>();
  //   const includedEdgeIndices = new Set<number>();
  //   const queue: number[] = [srcVId];

  //   while (queue.length > 0) {
  //     const curVId: number = queue.shift()?? 0;
  //     if (!curVId) {
  //       throw Error(`Invalid curVId during BFS of Graph ${this.Name}`);
  //     }

  //     if (!visitedVIds.has(curVId)) {
  //       visitedVIds.add(curVId);

  //       const adjVIds = this.getVertex(curVId).getAllAdjVertexIds();
  //       const nextVIds = new Set<number>();
  //       for (let adjVId of adjVIds) {
  //         const adjEdgeIndex = this.getEdgeIndex(curVId, adjVId);
  //         // if (!visitedVIds.has(adjVId) && !includedEdgeIndices.has(adjEdgeIndex)
  //         if (!includedEdgeIndices.has(adjEdgeIndex) && !disabledEdgeIndices.has(adjEdgeIndex) && includedEdgeIndices.size < maxEdges) {
  //           nextVIds.add(adjVId);
  //           includedEdgeIndices.add(adjEdgeIndex);
  //         }
  //       }

  //       if (nextVIds.size > 0) {
  //         queue.push(... nextVIds);
  //       }
  //     }
  //   }

  //   const subGraph = new UDGraph("Expanding SubGraph");
  //   visitedVIds.forEach(vId => {
  //     const vtx = this.getVertex(vId);
  //     subGraph.addVertex(vtx.Id, vtx.Label, vtx.Point);
  //   });

  //   includedEdgeIndices.forEach(edgeIndex => {
  //     const e = this.Edges[edgeIndex];
  //     if (visitedVIds.has(e.v1Id) && visitedVIds.has(e.v2Id)) {
  //       subGraph.addEdge(e.v1Id, e.v2Id, e.weight);
  //     }
  //   });

  //   return subGraph;
  // }

  public isFullyConnected(): boolean {
    var self = this;

    // Perform a BFS Traverse to  verify connectivity
    const visitedIds: number[] = [];
    const connectedGroups = this.bfsTraverse((v, i) => {
      visitedIds.push(v.Id);
    });

    return connectedGroups === 1;
  }

  public buildShortestPathMap(): any {
    const vIds = this.getAllVertexIds();
    const rawGraph: any = {};
    for (let vId of vIds) {
      var v = this.getVertex(vId);
      rawGraph[vId] = Object.assign({}, v._adjVertexDict);
    }

    const spm: any = {};
    for (let vId of vIds) {
      const { predecessors, costs } = Dijkstra.single_source_shortest_paths(rawGraph, vId, vId);
      spm[vId] = Object.assign({}, costs);
    }

    return spm;
  }

  public getShortestPathVertexList(sVId: number, dVId: number): number[] {
    const vIds = this.getAllVertexIds();
    const rawGraph: any = {};
    for (let vId of vIds) {
      var v = this.getVertex(vId);
      rawGraph[vId] = Object.assign({}, v._adjVertexDict);
    }

    const pathVIdList = Dijkstra.find_path(rawGraph, sVId, dVId);
    return pathVIdList;
  }
}

export function buildAdhocUDGraph(): UDGraph {
  const udg = new UDGraph("Albany Fake Streets Network");

  // Add all vertice into graph
  zone1VertexPoints.forEach((pt, i) => {
    const vId = i + 1;
    const vLabel = `${vId}`;

    udg.addVertex(vId, vLabel, pt);
  });

  // Add all edges (with weight assigned) into graph
  zone1Edges.forEach((evs, i) => {
    const v1Id = evs[0], v2Id = evs[1];
    const v1 = udg.getVertex(v1Id), v2 = udg.getVertex(v2Id);
    const weight = Math.round(Math.sqrt((v1.Point.x - v2.Point.x)**2 + (v1.Point.y - v2.Point.y)**2) * 10000);  //Math.round(v1.Point.distance(v2.Point) * 10);

    udg.addEdge(v1Id, v2Id, weight);
  });

  return udg;
}

export function findOptimumExpandingSubGraph(parentGraph: UDGraph, startVId: number, disabledEdgeIndices: Set<number>): UDGraph | undefined {
  let optOddVertexCount = 0;
  let optSubGraph: UDGraph | undefined;

  for (let maxSize = 6; maxSize < 26; ++maxSize) {
    // const subGraph = parentGraph.expandSubGraphFromVertex(startVId, disabledEdgeIndices, maxSize);
    const subGraph = parentGraph.expandSubGraphFromVertexWithDegreeCheck(startVId, disabledEdgeIndices, maxSize);
    const oddCount = subGraph.getOddDegreeVertices().length;
    // console.debug(`Found subgraph with ${subGraph.VertexCount} vertices and ${oddCount} odd-degree among vertices.`);
    if (!optSubGraph || optOddVertexCount > oddCount || (optOddVertexCount === oddCount && subGraph.VertexCount > optSubGraph.VertexCount)) {
      optSubGraph = subGraph;
      optOddVertexCount = oddCount;
    }
  }

  return optSubGraph;
}
