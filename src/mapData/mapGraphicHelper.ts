import esriConfig from '@arcgis/core/config.js';
import ArcGISMap from "@arcgis/core/Map";
import MapView from "@arcgis/core/views/MapView";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import TileLayer from "@arcgis/core/layers/TileLayer";
import Graphic from "@arcgis/core/Graphic";
import Geometry from "@arcgis/core/geometry/Geometry";
import Point from "@arcgis/core/geometry/Point";
import PictureMarkerSymbol from '@arcgis/core/symbols/PictureMarkerSymbol';
import Color from "@arcgis/core/Color";
import SimpleMarkerSymbol from '@arcgis/core/symbols/SimpleMarkerSymbol';
import TextSymbol from '@arcgis/core/symbols/TextSymbol';
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import Polyline from "@arcgis/core/geometry/Polyline";
import { buildAdhocUDGraph, IGraphEdge, UDGraph, UDGraphVertex } from "../graphHelpers/UDGraph";
import { IStaticRouteResult } from "../mapData/staticEsriRouteResult";


function createVertexGraphics(v: UDGraphVertex, foreColor: Color, backColor: Color): Graphic[] {

  const circleSymbol = {
    type: "simple-marker",
    color: backColor,
    size: "20px",
    outline: {
      color: Color.fromHex("#000"),
      width: 1
    }
  };

  const textSymbol = {
    type: "text",  // autocasts as new TextSymbol()
    color: foreColor,
    text: v.Label,
    xoffset: 0,
    yoffset: -5,
    font: {  // autocasts as new Font()
      size: 9,
      family: 'Arial',
      weight: "normal"
    }
  };

  const circleGraphic = new Graphic({
    attributes: { id: v.Id, label: v.Label, degree: v.Degree },
    geometry: v.Point.clone(),
    symbol: circleSymbol
  });

  const textGraphic = new Graphic({
    attributes: { id: v.Id, label: v.Label, degree: v.Degree },
    geometry: v.Point.clone(),
    symbol: textSymbol
  });

  return [circleGraphic, textGraphic];
}

export function createPathAnimationPointGraphic(pt: Point, color: Color): Graphic {

  // const iconSymbol = {
  //   type: "simple-marker",
  //   color: color,
  //   size: "15px",
  //   outline: {
  //     color: Color.fromHex("#000"),
  //     width: 1
  //   }
  // };

  let iconSymbol =  PictureMarkerSymbol.fromJSON({
    type: "picture-marker",  // autocasts as new PictureMarkerSymbol()
    url: "assets/imgs/web/police-car-256.png",
    width: "32px",
    height: "32px"
  });

  const pointGraphic = new Graphic({
    attributes: { id: "currentLocation"},
    geometry: pt.clone(),
    symbol: iconSymbol
  });

  return pointGraphic;
}

export function createPathAnimationTrailGraphic(startPt: Point, color: Color): Graphic {
  const lineSymbol = new SimpleLineSymbol({
    color: color,
    width: "5px",
    style: "solid"
  });

  var polyline = new Polyline({ spatialReference: startPt.spatialReference });

  var polylineGraphic = new Graphic({
    attributes: {},
    geometry: polyline,
    symbol: lineSymbol
  });

  return polylineGraphic;
}

export function createVRPVehicleGraphic(carId: number, pt: Point): Graphic {
  let iconSymbol =  PictureMarkerSymbol.fromJSON({
    type: "picture-marker",  // autocasts as new PictureMarkerSymbol()
    url: "assets/imgs/web/vrp-policecar-512.png",
    width: "32px",
    height: "32px"
  });

  const carGraphic = new Graphic({
    attributes: { vrpCarId: carId},
    geometry: pt.clone(),
    symbol: iconSymbol
  });

  return carGraphic;
}

function createEdgeLineGraphic(v1: UDGraphVertex, v2: UDGraphVertex, e: IGraphEdge, color: Color): Graphic {
  const lineSymbol = new SimpleLineSymbol({
    color: color,
    width: "2px",
    style: "solid"
  });

  var polyline = new Polyline();
  polyline.addPath([v1.Point.clone(), v2.Point.clone()]);

  var polylineGraphic = new Graphic({
    attributes: {v1Id: v1.Id, v2Id: v2.Id, weight: e.weight },
    geometry: polyline,
    symbol: lineSymbol
  });

  return polylineGraphic;
}


export function drawSimpleCPPGraph(graphLayer: GraphicsLayer): UDGraph {
  const cppGraph = buildAdhocUDGraph();

  // Add Edge graphics (lines) first
  cppGraph.Edges.forEach((e) => {
    const v1 = cppGraph.getVertex(e.v1Id), v2 = cppGraph.getVertex(e.v2Id);
    var polylineGraphic = createEdgeLineGraphic(v1, v2, e, Color.fromHex("#8c2907"));
    graphLayer.add(polylineGraphic);
  });

  // Add Vertex graphics after edge graphics so that they will display above edges (in same graphic layer)
  cppGraph.getAllVertexIds().forEach(vId => {
    const vertex = cppGraph.getVertex(vId);
    const vertexGraphics = createVertexGraphics(vertex, Color.fromHex("#000000"), Color.fromHex("#dbb01e"));
    graphLayer.addMany(vertexGraphics);
  });

  return cppGraph;
}

export function highLightUDGraph(hlLayer: GraphicsLayer, udg: UDGraph, color: Color): void {

  // hlLayer.graphics.removeAll(); // remove all existing graphics

  // Draw all
  const lineSymbol = new SimpleLineSymbol({
    color: color, // Color.fromHex("#77dd22"),
    width: "4px",
    style: "solid"
  });

  var polyline = new Polyline();
  udg.Edges.forEach(e => {
    const v1 = udg.getVertex(e.v1Id), v2 = udg.getVertex(e.v2Id);
    polyline.addPath([v1.Point.clone(), v2.Point.clone()]);
  });

  var polylineGraphic = new Graphic({
    attributes: {},
    geometry: polyline,
    symbol: lineSymbol
  });

  hlLayer.add(polylineGraphic);

}

function createPointByLocationAndSpatialRef(location: number[], spatialRef: any): Point {
  return new Point({
    x : location[0],
    y : location[1],
    spatialReference : spatialRef
  });
}

function doRoutePathMovingAnimation(
  pointGraphic: Graphic,
  newLocation: Point,
  spatialRef: any): Promise<any> {

    const startPoint = pointGraphic.geometry as Point,
    endPoint = newLocation,
    startLon = startPoint.longitude, startLat = startPoint.latitude,
    startX = startPoint.x, startY = startPoint.y,
    endLon = endPoint.longitude, endLat = endPoint.latitude,
    endX = endPoint.x, endY =  endPoint.y,
    offsetLon = (endLon - startLon), offsetLat = (endLat - startLat),
    distanceLonLat = Math.sqrt(offsetLon**2 + offsetLat**2),
    offsetX = endX - startX, offsetY = endY- startY,
    needMultipleFrames = distanceLonLat > 0.00001,
    isDocumentHidden = !!document.hidden,
    unitDistanceForAnimation = 0.0004,
    totalUnits = Math.max(1,Math.ceil(distanceLonLat / unitDistanceForAnimation)),
    framesPerUnit = 8,
    totalFrames = framesPerUnit * totalUnits,
    // totalFrames = 12,
    deltaX = offsetX/totalFrames, deltaY = offsetY/totalFrames;

  // console.debug(`$Move Vehicle ${pointGraphic.attributes.displayName} distance: ${distance}, totalUnits: ${totalUnits}, totalFrames: ${totalFrames}`);
  // Do animation move from start to end point
  return new Promise((resolve) => {
    let curX = startX, curY = startY;
    let singleFrameCallback = (frameIndex: number): void => {
      curX+=deltaX; // Step forward on x direction
      curY+=deltaY; // Step forward on y direction

      if(frameIndex < totalFrames && (curX < endX || curY < endY)) {
        // only do next move if frameIndex not reach end and x,y direction not exceed destination position
        movePoint([pointGraphic], curX, curY, spatialRef).then(()=> {
          singleFrameCallback(frameIndex + 1);
        });
      } else {
        resolve(true);
      }
    };

    singleFrameCallback(0); // start animation frames
  }).then(() => {
    // ensure the graphics reach last point (end position) at the end of animation
    return movePoint([pointGraphic], endX, endY, spatialRef);
  });
}

export function animateSingleRoutePathMovement(pointGraphic: Graphic, trailGraphic: Graphic, path: Array<number[]>, spatialRef: any): Promise<any> {
  if (!path || path.length === 0) {
    return Promise.resolve(null);
  }

  return new Promise(resolve => {

    function moveOneStep(i: number): void {
      const curNode = path[i];
      const tgtPoint = createPointByLocationAndSpatialRef(curNode, spatialRef);

      doRoutePathMovingAnimation(pointGraphic, tgtPoint, spatialRef).then(() => {

        // Append moved path segment into trailGraphic
        if (i > 0) {
          const prevNode = path[i-1];
          const prevPoint = createPointByLocationAndSpatialRef(prevNode, spatialRef);
          const curTrailLine = trailGraphic.geometry.clone() as Polyline;
          curTrailLine.addPath([prevPoint, tgtPoint]);
          trailGraphic.set("geometry", curTrailLine);
        }

        // Determine next move in path
        if (i >= path.length - 1) {
          resolve(null);
        } else {
          setTimeout(() => {
            moveOneStep(i + 1);
          }, 10);
        }
      });
    }

    moveOneStep(0);
  });
}

export function animateTraverseByRoutePaths(pointGraphic: Graphic, trailGraphic: Graphic, routeResult: IStaticRouteResult): Promise<any> {
  if (!routeResult || !routeResult.paths || routeResult.paths.length === 0) {
    return Promise.resolve(null);
  }

  const paths = routeResult.paths,
    spatialRef = routeResult.spatialReference;

  return new Promise(resolve => {
    function  traverseOnePath(i: number) {
      const curPath = paths[i];
      animateSingleRoutePathMovement(pointGraphic, trailGraphic, curPath, spatialRef).then(() => {
        if (i >= paths.length - 1) {
          resolve(null);
        } else {
          setTimeout(() => {
            traverseOnePath(i + 1);
          }, 800);
        }
      });
    }

    traverseOnePath(0);
  });
}

export function animateTraverseByPathVertices(animationLayer: GraphicsLayer, udg: UDGraph, pathVertexIds: number[]): Promise<any> {
  if (pathVertexIds.length < 2) return Promise.resolve(); // no edge in path

  const startVId = pathVertexIds[0];
  const startVertex = udg.getVertex(startVId);

  let pointGraphic: Graphic = animationLayer.graphics.find(g => g.attributes.id  === "currentLocation");
  if (!pointGraphic) {
    pointGraphic = createPathAnimationPointGraphic(startVertex.Point, Color.fromHex("#224466"));
    animationLayer.add(pointGraphic);
  }

  return new Promise(resolve => {

    function traverseOneEdge(i: number): void {
      const tgtVId = pathVertexIds[i];
      const tgtPoint = udg.getVertex(tgtVId).Point;

      doGraphicsMovingAnimation(pointGraphic, tgtPoint).then(() => {
        if (i >= pathVertexIds.length - 1) {
          resolve(null);
        } else {
          setTimeout(() => {
            traverseOneEdge(i + 1);
          }, 100);
        }
      });
    }

    traverseOneEdge(1);
  });
}

function doGraphicsMovingAnimation(
  pointGraphic: Graphic,
  newLocation: Point): Promise<any> {
  const endPoint = newLocation,
    startX = (pointGraphic.geometry as Point).x, startY = (pointGraphic.geometry as Point).y,
    endX = endPoint.x, endY =  endPoint.y,
    offsetX = endX - startX, offsetY = endY- startY,
    distance = Math.sqrt(offsetX**2 + offsetY**2),
    // needMultipleFrames = distance > 0.00001,
    isDocumentHidden = !!document.hidden,
    unitDistanceForAnimation = 0.0004,
    totalUnits = Math.max(1,Math.ceil(distance / unitDistanceForAnimation)),
    framesPerUnit = 4,
    totalFrames = framesPerUnit * totalUnits,
    deltaX = offsetX/totalFrames, deltaY = offsetY/totalFrames;

  // if (isDocumentHidden) {
  //   return movePointWithoutAnimation([pointGraphic, labelGraphic], endX, endY);
  // }

  // console.debug(`$Move Vehicle ${pointGraphic.attributes.displayName} distance: ${distance}, totalUnits: ${totalUnits}, totalFrames: ${totalFrames}`);
  // Do animation move from start to end point
  return new Promise((resolve) => {
    let curX = startX, curY = startY;
    let singleFrameCallback = (frameIndex: number): void => {
      curX+=deltaX; // Step forward on x direction
      curY+=deltaY; // Step forward on y direction

      if(frameIndex < totalFrames && (curX < endX || curY < endY)) {
        // only do next move if frameIndex not reach end and x,y direction not exceed destination position
        movePoint([pointGraphic], curX, curY, null).then(()=> {
          singleFrameCallback(frameIndex + 1);
        });
      } else {
        resolve(true);
      }
    };

    singleFrameCallback(0); // start animation frames
  }).then(() => {
    // ensure the graphics reach last point (end position) at the end of animation
    return movePoint([pointGraphic], endX, endY, null);
  });
}

function movePoint(graphics: Array<any>, x:number, y:number, spatialRef: any): Promise<any> {
  return new Promise((res) => {
    requestAnimationFrame(() => {
      for (let graphic of graphics) {
        graphic.set("geometry", new Point({x: x, y: y, spatialReference : spatialRef}));
      }

      res(true);
    });
  });
}
