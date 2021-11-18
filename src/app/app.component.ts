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
import Query from "@arcgis/core/tasks/support/Query";
import Graphic from "@arcgis/core/Graphic";
import Color from "@arcgis/core/Color";
import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import { whenOnce, pausable } from "@arcgis/core/core/watchUtils";
import Basemap from "@arcgis/core/Basemap";
import BasemapGallery from "@arcgis/core/widgets/BasemapGallery";
import BasemapGalleryItem from "@arcgis/core/widgets/BasemapGallery/support/BasemapGalleryItem";
import { createVRPVehicleGraphics, createPathAnimationPointGraphic, createPathAnimationTrailGraphic, drawSimpleCPPGraph, highLightUDGraph, animateTraverseByPathVertices, animateTraverseByRoutePaths } from "../mapData/mapGraphicHelper";
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

  public activeVrpVehicleBtnId: number = 0;


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
        id: "streetsLayer",
        url:arcgisServerUrl+"Patrol/PatrolStreetsAndStops/MapServer/2"
    });

    var solveAnimationLayer = new GraphicsLayer({
      id: "solveAnimationLayer",
      title: "solveAnimation",
      visible: true,
    });

    var vrpAnimationLayer = new GraphicsLayer({
      id: "vrpAnimationLayer",
      title: "vrpAnimation",
      visible: true,
    });

    this._map?.layers.addMany([streetsLayer,solveAnimationLayer, vrpAnimationLayer, pathSolveLayer,stopsSolveLayer]);

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

    self._view?.hitTest(sPoint).then(resp => {
      if (resp.results.length > 0) {
        const hitGraphicsInStreetsLayer = resp.results.filter(r => {
          return r.graphic.layer.id === "streetsLayer";
        });

        if (hitGraphicsInStreetsLayer[0] && hitGraphicsInStreetsLayer[0].graphic) {
          if (self.isInSolvingMode && !self.isSolvingInProgress) {
            self.SolveAndDraw(mPoint);
          }

          if (self.activeVrpVehicleBtnId >= 1 && self.activeVrpVehicleBtnId <=3) {
            self.tryAddVRPVehicleOnMap(mPoint);
          }
        }
      }
    });



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
        return self.animateSolveRouteResult(solvedResult, solveAnimationLayer, [pointGraphic], trailGraphic);
      }

      return null;
    }).finally(() => {
      self.isSolvingInProgress = false;
    });
  }

  animateSolveRouteResult(routeResult: any, layer: GraphicsLayer, pointGraphics: Graphic[], trailGraphic: Graphic): Promise<any> {
    const self = this;

    if (routeResult && layer) {
      const pathsGeometry = routeResult.route.geometry as Polyline;

      return animateTraverseByRoutePaths(pointGraphics, trailGraphic, pathsGeometry);
    }

    return Promise.resolve(null);
  }

  runTest(evt: any): void {
    const self = this;
    console.debug(`runTest now...`);

    const query = new Query({
      outFields: ["*"],
      where: "1=1",
      returnGeometry: true,
    });

    const fLayer = self._map?.layers.getItemAt(0) as FeatureLayer;
    fLayer.queryFeatures(query).then( qr => {
      console.log(qr);
    });
  }

  solveRouteClick(evt: any): void {
    const self = this,
      preSolvingMode = self.isInSolvingMode;

    self.isInSolvingMode = !preSolvingMode;

    const vrpAnimationLayer = self._map?.layers.find(l => l.id === "vrpAnimationLayer") as GraphicsLayer;
    self.activeVrpVehicleBtnId = 0;
    vrpAnimationLayer.removeAll();
  }

  activateVRPVehicleClick(evt: any, vrpVehicleId: number): void {

    if (typeof(vrpVehicleId) !== "number" || vrpVehicleId < 1 || vrpVehicleId > 3) {
      return;
    }

    const self = this,
      prevVrpVehicleId = self.activeVrpVehicleBtnId,
      solveAnimationLayer = self._map?.layers.find(l => l.id ==="solveAnimationLayer") as GraphicsLayer;
      self.isSolvingInProgress = false;
      self.isInSolvingMode = false;
      solveAnimationLayer.removeAll();

    if (prevVrpVehicleId === vrpVehicleId) {
      self.activeVrpVehicleBtnId = 0; // Deactivte current selected vrp button
    } else {
      self.activeVrpVehicleBtnId = vrpVehicleId;
    }
  }

  tryAddVRPVehicleOnMap(pt: Point): void {
    const self = this,
      carId = self.activeVrpVehicleBtnId;

    if ([1, 2, 3].indexOf(carId) < 0) {
      return;
    }

    const vrpLayer = self._map?.layers.find(l => l.id === "vrpAnimationLayer") as GraphicsLayer;
    if (vrpLayer) {
      let carGraphics: Graphic[] = vrpLayer.graphics.filter(g => g.attributes.vrpCarId === carId).toArray();
      if (!carGraphics || carGraphics.length === 0) {
        carGraphics = createVRPVehicleGraphics(carId, pt);
        vrpLayer.graphics.addMany(carGraphics);
      } else {
        carGraphics.forEach(cg => {
          cg.set("geometry", pt.clone());
        })
      }
    }

  }

  computeVRPRoute(evt: any): void {
    const self = this,
      solveAnimationLayer = self._map?.layers.find(l => l.id ==="solveAnimationLayer") as GraphicsLayer,
      vrpAnimationLayer = self._map?.layers.find(l => l.id === "vrpAnimationLayer") as GraphicsLayer,
      stopsLayer = self._map?.layers.find(l=> l.id === "stopsSolveLayer") as GraphicsLayer;

    self.isSolvingInProgress = false;
    self.isInSolvingMode = false;
    solveAnimationLayer.removeAll();

	  self.activeVrpVehicleBtnId = 0; // Deselect VRP Vehicle Button
    const vrpPathAnimationGraphics = vrpAnimationLayer.graphics.filter(g => g.attributes.isHeadNode !== true); // Find non-Head vrp graphics (path graphics)
    if (vrpPathAnimationGraphics.length > 0) {
      vrpAnimationLayer.graphics.removeMany(vrpPathAnimationGraphics);
    }
    stopsLayer.graphics.removeAll();


    let carNum = 0;
    const car1Graphics = vrpAnimationLayer.graphics.filter(g => g.attributes.vrpCarId === 1).toArray();
    const car2Graphics = vrpAnimationLayer.graphics.filter(g => g.attributes.vrpCarId === 2).toArray();
    const car3Graphics = vrpAnimationLayer.graphics.filter(g => g.attributes.vrpCarId === 3).toArray();

    let carGraphicsList: Array<Graphic[]> = [];
    if (car1Graphics.length > 0) { carGraphicsList.push(car1Graphics); carNum++;}
    if (car2Graphics.length > 0) { carGraphicsList.push(car2Graphics); carNum++;}
    if (car3Graphics.length > 0) { carGraphicsList.push(car3Graphics); carNum++;}

    if (carNum === 0) {
      console.warn(`No Vrp Vehicle found!`);
      return;
    }

    let vrpResult:any = null;
    let carColors = self.getColors(carNum);
    self.isLoadingData = true;
    self.isSolvingInProgress = true;
    console.debug(`Gonna compute VRP Route for ${carNum} cars`);

    const carPosGraphics = carGraphicsList.map(cgl => cgl[0]);
    vrp(carPosGraphics,self._allStops).then(function(result){
        vrpResult = result;
        self.drawVrpStops(vrpResult.stops, carColors, vrpResult.routes);
    }).then(() => {
      return self.delay(2000);
    }).then(() => {
      self.isLoadingData = false;
      if (vrpResult && vrpResult.routes) {
        return self.animateVRPRouteResult(vrpResult.routes, carColors, carGraphicsList, vrpAnimationLayer);
      }
      return null;
    }).finally(() => {
      self.isSolvingInProgress = false;
    });
  }

  drawSolvedStops(routeResult:any,stopsLayer:GraphicsLayer):void{
      if(routeResult.stops&&routeResult.stops.length>0){
        for (let index = 0; index < routeResult.stops.length; index++) {
            let stop = routeResult.stops[index];
            let stopGraphic = new Graphic({
                geometry:stop.geometry,
                symbol:new SimpleMarkerSymbol({
                    style: "circle",
                    color: "#888800",
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

  drawVrpStops(stops:any[], colors:string[], routes:any[]):void{
    const self = this;
    const stopsLayer = self._map?.layers.find(l=> l.id === "stopsSolveLayer") as GraphicsLayer;
    //add first stop
    for (let index = 0; index < routes.length; index++) {
        let firstPoint = new Point({
            x:routes[index].geometry.paths[0][0][0],
            y:routes[index].geometry.paths[0][0][1],
            spatialReference:routes[index].geometry.spatialReference
        });
        stopsLayer.graphics.add(self.createStopGraphic(firstPoint, colors[routes[index].attributes.Name]));
        stopsLayer.graphics.add(self.createStopLabelGraphic(firstPoint, 1));
    }

    //add other stops
    for (let index = 0; index < stops.length; index++) {
        let stop = stops[index];
        let stopGraphic = self.createStopGraphic(stop.geometry, colors[stop.attributes.RouteName]);
        stopsLayer.graphics.add(stopGraphic);
        let stopLabelGraphic = self.createStopLabelGraphic(stop.geometry, stop.attributes.Sequence);
        stopsLayer.graphics.add(stopLabelGraphic);

        if(stop.attributes.Sequence!=1 && stop.attributes.Name.indexOf("mid_")>=0){
            let routeGeometry = routes[stop.attributes.RouteName].geometry;
            let crossTimesGraphic = new Graphic({
                symbol:new TextSymbol({
                    text:getCrossTimes(stop, routeGeometry).toString(),
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

  animateVRPRouteResult(routes: any[], carColors: any[], carGraphicsList: Array<Graphic[]>, vrpAnimationLayer: GraphicsLayer): Promise<any> {
    const self = this;
    let promises = [];
    for (let index = 0; index < routes.length; index++) {
        let firstPoint = new Point({
            x:routes[index].geometry.paths[0][0][0],
            y:routes[index].geometry.paths[0][0][1],
            spatialReference:routes[index].geometry.spatialReference
        })
        // let pointGraphic = createPathAnimationPointGraphic(firstPoint, carColors[index]);
        let trailGraphic = createPathAnimationTrailGraphic(firstPoint, carColors[index]);
        vrpAnimationLayer.addMany([trailGraphic]);
        promises.push(animateTraverseByRoutePaths(carGraphicsList[index],trailGraphic, routes[index].geometry));
    }
    return Promise.all(promises).then(function(){
        return;
    });
  }

  getColors(num:number):string[]{
    let colors = ["red","blue","green"];
    // for (let index = 0; index < num; index++) {
    //     var letters = "12345678".split("");
    //     var color = "#";
    //     for (var i = 0; i < 6; i++)
    //     {
    //         color += letters[Math.round(Math.random() * 7)];
    //     }
    //     colors.push(color);
    // }
    return colors;
  }

  delay(millionSeconds: number): Promise<any> {
    millionSeconds = Math.max(0, millionSeconds);
    return new Promise(res => {
      setTimeout(() => {
        res(null);
      }, millionSeconds);
    });
  }

  createStopGraphic(stopGeometry:Point, color:string):Graphic{
      return new Graphic({
                geometry: stopGeometry,
                symbol:new SimpleMarkerSymbol({
                    style: "circle",
                    color: color,
                    size:  16,
                    outline: {
                        type: "simple-line",
                        style: "solid",
                        color: "black",
                        width: 2
                    }
                })
        });
  }

  createStopLabelGraphic(stopGeometry:Point, sequence:number):Graphic{
    return new Graphic({
                symbol:new TextSymbol({
                    text:sequence.toString(),
                    color:"white",
                }),
                geometry:stopGeometry
        });
  }
}
