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
import { createPathAnimationPointGraphic, createPathAnimationTrailGraphic, drawSimpleCPPGraph, highLightUDGraph, animateTraverseByPathVertices, animateTraverseByRoutePaths } from "../mapData/mapGraphicHelper";
import { UDGraph, findOptimumExpandingSubGraph } from 'src/graphHelpers/UDGraph';
import { trySolveChinesePostmanProblem } from 'src/graphHelpers/ChinesePostman';
import { arcgisServerUrl,getStops,solve,getCrossTimes,vrp } from '../graphHelpers/ESRISolveModel';
import * as Blossom from "../graphHelpers/blossom";
import { findEularianTour, IEularianGraphEdge } from "../graphHelpers/EularianPath";
import TextSymbol from '@arcgis/core/symbols/TextSymbol';
import SimpleMarkerSymbol from '@arcgis/core/symbols/SimpleMarkerSymbol';
import { staticRouteResult } from 'src/mapData/staticEsriRouteResult';


@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent implements OnInit, OnDestroy {
  public _map: ArcGISMap | undefined;
  public _view: MapView | undefined;
  public _cppGraph: UDGraph | undefined;
  public _allStops: any[] = [];
  public isInSolvingMode: boolean = false;
  public isSolvingInProgress: boolean = false;
  public isLoadingData: boolean = false;

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
    var solveAnimationLayer = new GraphicsLayer({
      id: "solveAnimationLayer",
      title: "solveAnimation",
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

    this._map?.layers.addMany([streetsLayer,pathSolveLayer,stopsSolveLayer, solveAnimationLayer]);

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

    if (self.isInSolvingMode && !self.isSolvingInProgress) {
      self.SolveAndDraw(mPoint);
    }
  }

  SolveAndDraw(mPoint:Point): Promise<any> {
    const self = this;
    const pathLayer = self._map?.layers.find(l=> l.id === "pathSolveLayer") as GraphicsLayer;
    const stopsLayer = self._map?.layers.find(l=> l.id === "stopsSolveLayer") as GraphicsLayer;
    const solveAnimationLayer = self._map?.layers.find(l => l.id ==="solveAnimationLayer") as GraphicsLayer;

    //clear graphics
    pathLayer.graphics.removeAll();
    stopsLayer.graphics.removeAll();
    solveAnimationLayer.graphics.removeAll();

    // Add a new Graphic for the police vehicle
    const pointGraphic = createPathAnimationPointGraphic(mPoint, Color.fromHex("#888800"));
    const trailGraphic = createPathAnimationTrailGraphic(mPoint, Color.fromHex("#888800"));
    solveAnimationLayer.addMany([pointGraphic, trailGraphic]);

    let clickedStop = {
        geometry:mPoint,
        attributes:{
            CurbApproach:3,//no u-turn
            Name:"start"
        }
    }

    let solvedResult: any = null;
    self.isLoadingData = true;
    self.isSolvingInProgress = true;
    
    // return vrp([mPoint],self._allStops).then(function(vrpResult){
    //     console.log(vrpResult)
    // });
    
    return solve(mPoint,[clickedStop].concat(self._allStops)).then(function(routeResult){
        if(routeResult){
          solvedResult = routeResult;
            if(routeResult.route&&routeResult.route.geometry){
                self.drawSolvedStops(routeResult,stopsLayer);
            }
        }
    }).then(() => {
      return self.delay(2000);
    }).then(() => {
      self.isLoadingData = false;
      if (solvedResult) {
        return self.animateSolveRouteResult(solvedResult, solveAnimationLayer, pointGraphic, trailGraphic);
      }

      return null;
    }).finally(() => {
      self.isSolvingInProgress = false;
    });
  }

  animateSolveRouteResult(routeResult: any, layer: GraphicsLayer, pointGraphic: Graphic, trailGraphic: Graphic): Promise<any> {
    console.debug(`animateSolveRouteResult now...`);
    const self = this;

    if (routeResult && layer) {
      const pathsGeometry = routeResult.route.geometry;
      const firstLocation = pathsGeometry.paths[0][0];
      // const firstPoint = new Point({
      //   x : firstLocation[0],
      //   y : firstLocation[1],
      //   spatialReference : pathsGeometry.spatialReference
      // });

      return animateTraverseByRoutePaths(pointGraphic, trailGraphic, pathsGeometry);
    }

    return Promise.resolve(null);
  }

  runTest(evt: any): void {
    const self = this;
    console.debug(`runTest now...`);


  }

  solveRouteClick(evt: any): void {
    const self = this,
      preSolvingMode = self.isInSolvingMode;

    self.isInSolvingMode = !preSolvingMode;
  }

  drawSolvedStops(routeResult:any,stopsLayer:GraphicsLayer):void{
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

            if(index!=0 && stop.attributes.Name.indexOf("mid_")>=0){
                let crossTimesGraphic = new Graphic({
                    symbol:new TextSymbol({
                        text:getCrossTimes(stop, routeResult.route.geometry).toString(),
                        color:"black",
                        xoffset: 15,
                        yoffset: 15,
                    }),
                    geometry:stop.geometry
                });
                stopsLayer.graphics.add(crossTimesGraphic);
            }
        }
    }
  }

  delay(millionSeconds: number): Promise<any> {
    millionSeconds = Math.max(0, millionSeconds);
    return new Promise(res => {
      setTimeout(() => {
        res(null);
      }, millionSeconds);
    });
  }
}
