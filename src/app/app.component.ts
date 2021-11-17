import {
  Component,
  OnInit,
  ViewChild,
  ElementRef,
  OnDestroy,
} from '@angular/core';

import esriConfig from '@arcgis/core/config.js';
import ArcGISMap from "@arcgis/core/Map";
import MapView from "@arcgis/core/views/MapView";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import TileLayer from "@arcgis/core/layers/TileLayer";
import Graphic from "@arcgis/core/Graphic";
import Color from "@arcgis/core/Color";
import Point from "@arcgis/core/geometry/Point";
import { whenOnce, pausable } from "@arcgis/core/core/watchUtils";
import Basemap from "@arcgis/core/Basemap";
import BasemapGallery from "@arcgis/core/widgets/BasemapGallery";
import BasemapGalleryItem from "@arcgis/core/widgets/BasemapGallery/support/BasemapGalleryItem";
import { drawSimpleCPPGraph, highLightUDGraph, animateTraverseByPathVertices } from "../mapData/mapGraphicHelper";
import { UDGraph, findOptimumExpandingSubGraph } from 'src/graphHelpers/UDGraph';
import { trySolveChinesePostmanProblem } from 'src/graphHelpers/ChinesePostman';
import { getStops,solve,arcgisServerUrl } from '../graphHelpers/ESRISolveModel';
import * as Blossom from "../graphHelpers/blossom";
import { findEularianTour, IEularianGraphEdge } from "../graphHelpers/EularianPath";
import TextSymbol from '@arcgis/core/symbols/TextSymbol';
import SimpleMarkerSymbol from '@arcgis/core/symbols/SimpleMarkerSymbol';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
})
export class AppComponent implements OnInit, OnDestroy {
  public _map: ArcGISMap | undefined;
  public _view: MapView | undefined;
  public _cppGraph: UDGraph | undefined;
  public _allStops: any[] = [];

  expandingStartVertexId: number = 1;

  // The <div> where we will place the map
  @ViewChild('mapViewNode', { static: true })
  private mapViewEl!: ElementRef;
  @ViewChild('controlPanelNode', { static: true})
  private controlPanelEl!: ElementRef;

  initializeMap(): Promise<any> {
    const self = this;
    const isMobile = false;
    const defaultBasemap = "streets";
    const container = this.mapViewEl.nativeElement;

    // // Required: Set this property to insure assets resolve correctly.
    // esriConfig.apiKey = "";
    // esriConfig.assetsPath = './assets';

    // self._minZoomLevel = isMobile ? 2 : 3;
    // self._maxZoomLevel = 20;

    self._map = new ArcGISMap({
      basemap: defaultBasemap
    });

    const view = new MapView({
      container: container,
      center: [-101.7591029, 42.824122413916704],
      map: self._map,
      zoom: isMobile ? 3 : 5,
      spatialReference: {
        wkid: 102100
      },
      highlightOptions: {
        color: [255, 255, 0, 1],
        fillOpacity: 0
      },
      constraints: {
        rotationEnabled: false
      }
    });

    view.popup.collapseEnabled = false; // disable popup collapse

    // Add Layers into map
    var simpleCPPLayer = new GraphicsLayer({
      id: "simpleCPPLayer",
      title: "SimpleCPP",
      visible: true,
    });

    var bfsExpandingLayer = new GraphicsLayer({
      id: "bfsExpandingLayer",
      title: "BFSExpanding",
      visible: true,
    });

    var pathAnimationLayer = new GraphicsLayer({
      id: "pathAnimationLayer",
      title: "PathAnimation",
      visible: true,
    });

    var pathSolveLayer = new GraphicsLayer({
      id: "pathSolveLayer",
      title: "PathSolve",
      visible: true,
    });

    var stopsSolveLayer = new GraphicsLayer({
      id: "stopsSolveLayer",
      title: "stopsSolve",
      visible: true,
    });

    var streetsLayer = new FeatureLayer({
        url:arcgisServerUrl+"Patrol/PatrolStreetsAndStops/MapServer/2"
    });

    this._map?.layers.addMany([streetsLayer,pathSolveLayer,stopsSolveLayer]);

    // Bind map events
    view.on("click", self.onMapClick.bind(self));
    view.on("double-click", self.onMapDblClick.bind(self));


    self._view = view;
    return self._view.when(function()
    {
      if (self._view)
      {
        const defaultCenter = new Point({
          latitude: 42.824122413916704,
          longitude: -73.89219578025492});
        self._view.zoom = 16;
        self._view.goTo(defaultCenter);
      }
    });
  }

  ngOnInit(): any {
    const self = this;
    // get stops
    getStops().then(function(stops){
        self._allStops = stops;
    });
    // Initialize MapView and return an instance of MapView
    this.initializeMap().then(() => {
      // The map has been initialized
        console.log('The map is ready.');
    });
  }

  ngOnDestroy(): void {
    if (this._view) {
      // destroy the map view
      this._view.destroy();
    }
  }

  onMapDblClick(evt: any): void {
    if (this._view)
    {
      switch (evt.button) {
        case 0:
          this._view.zoom += 1;
          // zoomAndRecenterMapViewWhenNecessary(true); // User triggered
          break;
        case 1:
          break;
        case 2:
          if (this._view.zoom > 0) {
            this._view.zoom -= 1;
            // zoomAndRecenterMapViewWhenNecessary(true); // User triggered
          }
          break;
      }
    }

    evt.stopPropagation();
  }

  onMapClick(evt: any): void {
    const self = this,
      mPoint = evt.mapPoint,
      sPoint = evt.screenPoint;
    console.log(`Clicked MapPoint: {longitude: ${mPoint.longitude}, latitude: ${mPoint.latitude}}, ScreenPoint: (x: ${sPoint.x}, y: ${sPoint.y})`);
    self.SolveAndDraw(mPoint);
  }

  SolveAndDraw(mPoint:Point):void{
    const self = this;
    const pathLayer = self._map?.layers.find(l=> l.id === "pathSolveLayer") as GraphicsLayer;
    const stopsLayer = self._map?.layers.find(l=> l.id === "stopsSolveLayer") as GraphicsLayer;

    //clear graphics
    pathLayer.graphics.removeAll();
    stopsLayer.graphics.removeAll();

    let clickedStop = {
        geometry:mPoint,
        attributes:{
            CurbApproach:3,//no u-turn
            Name:"start"
        }
    }

    solve(mPoint,[clickedStop].concat(self._allStops)).then(function(routeResult){
        if(routeResult){
            if(routeResult.route&&routeResult.route.geometry){
                pathLayer.add(new Graphic({geometry:routeResult.route.geometry}));
            }
            if(routeResult.stops&&routeResult.stops.length>0){
                for (let index = 0; index < routeResult.stops.length; index++) {
                    let stop = routeResult.stops[index];
                    let stopGraphic = new Graphic({
                        geometry:stop.geometry,
                        symbol:new SimpleMarkerSymbol({
                            style: "circle",
                            color: "blue",
                            size:  16,
                            outline: {
                                type: "simple-line",
                                style: "solid",
                                color: "black",
                                width: 2
                            }
                        })
                    });
                    stopsLayer.graphics.add(stopGraphic);
                    let stopLabelGraphic = new Graphic({
                        symbol:new TextSymbol({
                            text:stop.attributes.Sequence,
                            color:"white",
                        }),
                        geometry:stop.geometry
                    });
                    stopsLayer.graphics.add(stopLabelGraphic);
                }
            }
        }
    });
  }

  initSimpleCPPClick(evt: any): void {
    const self = this;
    console.debug(`REady to initialize CPP graph`);
    const cppLayer = this._map?.layers.find(l=> l.id === "simpleCPPLayer") as GraphicsLayer;
    if (cppLayer)
    {
      if (cppLayer.graphics.length > 0)
      {
        if (!confirm("Are you sure to reinitialize the CPP layer?")) {
          return;
        }

        cppLayer.graphics.removeAll();
      }

       self._cppGraph = drawSimpleCPPGraph(cppLayer);


    }
  }

  runGraphTest(evt: any): void {
    var self = this;
    // console.debug(`runGraphTest is clicked ${new Date()}`);
    // var gd = {
    //   1: {2: 5, 3: 7, 5: 1},
    //   2: {1: 5, 4: 6, 5: 7},
    //   3: {1: 7, 4: 8, 5: 5},
    //   4: {3: 8, 2: 6, 5: 3},
    //   5: {1: 1, 2: 7, 3: 5, 4: 3 }
    // };


    // var { path, cost } = Dijkstra.find_path_and_cost(gd, 2, 3);
    // console.debug(`from 2 to 3, min_cost: ${cost} path: ${JSON.stringify(path)}`);
    // console.debug(``);

    // const spm = self._cppGraph?.buildShortestPathMap();
    // if (spm) {
    //   console.debug(spm);
    // }

    // var data = [
    //   [0, 1, 1/2],
    //   [0, 2, 1/1],
    //   [0, 3, 1/5],
    //   [1, 2, 1/6],
    //   [1, 3, 1/3],
    //   [2, 3, 1/4]
    // ];
    // var results = Blossom(data);
    // console.debug(`Blossom result: ${results}`);


    // const vIds: number[] = [1,2,3,4,5,6];
    // const edges: IEularianGraphEdge[] = [
    //   {vId1: 1, vId2: 6, isDisabled: false, isVirtual: false, virtualVIds: []},
    //   {vId1: 2, vId2: 6, isDisabled: false, isVirtual: false, virtualVIds: []},
    //   {vId1: 1, vId2: 2, isDisabled: false, isVirtual: false, virtualVIds: []},
    //   {vId1: 1, vId2: 3, isDisabled: false, isVirtual: false, virtualVIds: []},
    //   {vId1: 2, vId2: 4, isDisabled: false, isVirtual: false, virtualVIds: []},
    //   {vId1: 3, vId2: 4, isDisabled: false, isVirtual: false, virtualVIds: []},
    //   {vId1: 3, vId2: 5, isDisabled: false, isVirtual: false, virtualVIds: []},
    //   {vId1: 4, vId2: 5, isDisabled: false, isVirtual: false, virtualVIds: []},
    //   {vId1: 1, vId2: 4, isDisabled: false, isVirtual: false, virtualVIds: []},
    //   {vId1: 2, vId2: 3, isDisabled: false, isVirtual: false, virtualVIds: []},
    // ];

    // const ep = findEularianTour(vIds, edges);
    // console.debug(ep);

    if (self._cppGraph) {
      const parentGraph = self._cppGraph;
      const animationPathLayer = self._map?.layers.find(l => l.id === "pathAnimationLayer") as GraphicsLayer;
      const cppPathVIds = trySolveChinesePostmanProblem(self._cppGraph);
      console.debug(`Solve CPP on Graph: "${self._cppGraph.Name}" => ${JSON.stringify(cppPathVIds)}`);

      animateTraverseByPathVertices(animationPathLayer, parentGraph, cppPathVIds).then(() => {
        animationPathLayer.removeAll();
      });
    }


  }

  tryExpandingVertexGroup(evt: any): void {
    const self = this,
      delayInSeconds = 2,
      baseLineColorData: number[] = [22, 33, 44],
      selectedVId = self.expandingStartVertexId,
      expSubGraphLayer = self._map?.layers.find(l => l.id === "bfsExpandingLayer") as GraphicsLayer,
      animationPathLayer = self._map?.layers.find(l => l.id === "pathAnimationLayer") as GraphicsLayer;

    console.debug(`tryExpanding from Vertex: ${selectedVId}`);
    const edgeIndicesAlreadyCovered = new Set<number>();
    const maxExpandCount = 100;

    const edgeVisitedCountMap = new Map<number, number>();

    function expandOnce(srcVId: number, expIndex: number) {
      if (self._cppGraph) {
        const parentGraph: UDGraph = self._cppGraph;
        const shortestPathMap: any = parentGraph.buildShortestPathMap();

        const optSubGraph = findOptimumExpandingSubGraph(parentGraph, srcVId, edgeIndicesAlreadyCovered);
        const optOddVertexCount = optSubGraph?.getOddDegreeVertices().length;

        if (optSubGraph) {
          console.debug(`Got expanded SubGraph (${optOddVertexCount}O/${optSubGraph.VertexCount}V) from Vertex ${srcVId} => ${JSON.stringify(optSubGraph.getAllVertexIds())}`);
          if (expSubGraphLayer) {
            var rnd =
            baseLineColorData[0] = Math.floor(Math.random() * 10000 % 200 + 55);
            baseLineColorData[1] = Math.floor(Math.random() * 10000 % 200 + 55);
            baseLineColorData[2] = Math.floor(Math.random() * 10000 % 200 + 55);
            console.debug(baseLineColorData);
            const lineColor = new Color([baseLineColorData[0], baseLineColorData[1], baseLineColorData[2]]);
            highLightUDGraph(expSubGraphLayer, optSubGraph, lineColor);
          }

          optSubGraph.Edges.forEach(e => {
            const edgeIndexInParentGraph = parentGraph.getEdgeIndex(e.v1Id, e.v2Id);
            edgeIndicesAlreadyCovered.add(edgeIndexInParentGraph);
          });

          const cppPathVIds = trySolveChinesePostmanProblem(optSubGraph);
          console.debug(`Solve CPP on OptSubGraph: => ${JSON.stringify(cppPathVIds)}`);

          animateTraverseByPathVertices(animationPathLayer, parentGraph, cppPathVIds).then(() => {
            // Determine the next source VId
            let found: boolean = false;
            let nextSrcVId: number = 0;
            let nextSrcVIdDistance: number;

            const vIdsInOptSubGraph = optSubGraph.getAllVertexIds();
            for (let oldVId of vIdsInOptSubGraph) {
              var adjVIds = parentGraph.getVertex(oldVId).getAllAdjVertexIds();  // Obtain the neighbour vertices from the parent (root graph)

              for (let adjVId of adjVIds) {
                const adjEdgeIndex = parentGraph.getEdgeIndex(oldVId, adjVId);
                if (!edgeIndicesAlreadyCovered.has(adjEdgeIndex)) {
                  nextSrcVId = oldVId;
                  found = true;
                  break;
                }
              }

              if (found) break;
            }

            if (!found) {
              console.warn(`Cannot find further expanding subgraph from previous expanded graph`);
              // Then, we try locating remaining edges which has not been visited
              let distanceToFoundEdge: number = 999999;
              parentGraph.Edges.forEach((e, i) => {
                if (!edgeIndicesAlreadyCovered.has(i)) {
                  const distanceToEdge = Math.min(shortestPathMap[srcVId][e.v1Id], shortestPathMap[srcVId][e.v2Id]);
                  if (!found || distanceToEdge < distanceToFoundEdge) {
                    nextSrcVId = e.v1Id;
                    distanceToFoundEdge = distanceToEdge;
                    found = true;
                  }
                }
              });
            }

            if (!found) {
              console.warn(`Cannot find further expanding subgraph from uncovered edges.`);
              console.debug(`============ Visited Map of ${edgeVisitedCountMap.size} edges ================`);
              var countMap = new Map<number, number>();
              edgeVisitedCountMap.forEach((count, edgeIndex) => {
                // console.debug(`EdgeIndex: ${edgeIndex}, Visited: ${count}`);
                if (!countMap.has(count)) {
                  countMap.set(count, 0);
                }

                const curNumOfVertices = countMap.get(count) ?? 0;
                countMap.set(count, curNumOfVertices + 1);
              });

              countMap.forEach((numOfVertices, visitedCount) => {
                console.debug(`Visited Count: ${visitedCount}, NumOfVertices: ${numOfVertices}`);
              });
            } else {
              // trigger the next expanding
              expIndex++;
              if (expIndex < maxExpandCount) {
                // setTimeout(() => {
                //   expandOnce(nextSrcVId, expIndex);
                // }, delayInSeconds * 1000);

                if (srcVId !== nextSrcVId) {
                  const pathToNextSrcVIds = parentGraph.getShortestPathVertexList(srcVId, nextSrcVId);
                  animateTraverseByPathVertices(animationPathLayer, parentGraph, pathToNextSrcVIds).then(() => {
                    // Update edgeVisitedCountMap
                    for (let i = 0; i < pathToNextSrcVIds.length - 1; ++i) {
                      const pV1Id = pathToNextSrcVIds[i], pV2Id = pathToNextSrcVIds[i + 1];
                      const edgeIndex = parentGraph.getEdgeIndex(pV1Id, pV2Id);

                      if (!edgeVisitedCountMap.has(edgeIndex)) {
                        edgeVisitedCountMap.set(edgeIndex, 1);
                      } else {
                        const prevCount = edgeVisitedCountMap.get(edgeIndex) ?? 0;
                        edgeVisitedCountMap.set(edgeIndex, prevCount + 1);
                      }
                    }

                    expandOnce(nextSrcVId, expIndex);
                  });
                } else {
                  setTimeout(() => {
                    expandOnce(nextSrcVId, expIndex);
                  }, delayInSeconds * 1000);
                }
              }
            }
          }).then(() => {
            // Update edgeVisitedCountMap
            for (let i = 0; i < cppPathVIds.length - 1; ++i) {
              const pV1Id = cppPathVIds[i], pV2Id = cppPathVIds[i+1];
              const edgeIndex = parentGraph.getEdgeIndex(pV1Id, pV2Id);

              if (!edgeVisitedCountMap.has(edgeIndex)) {
                edgeVisitedCountMap.set(edgeIndex, 1);
              } else {
                const prevCount = edgeVisitedCountMap.get(edgeIndex)?? 0;
                edgeVisitedCountMap.set(edgeIndex, prevCount + 1);
              }
            }
          });

        }

      }
    }

    expSubGraphLayer.removeAll();
    expandOnce(selectedVId, 0);

  }
}
