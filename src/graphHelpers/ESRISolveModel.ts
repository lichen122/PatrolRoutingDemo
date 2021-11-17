import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import Query from "@arcgis/core/tasks/support/Query";
import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import RouteParameters from "@arcgis/core/tasks/support/RouteParameters";
import FeatureSet from "@arcgis/core/tasks/support/FeatureSet";
import RouteTask from "@arcgis/core/tasks/RouteTask";
import * as geometryEngine from "@arcgis/core/geometry/geometryEngine";

export const arcgisServerUrl:string = "http://serviceplus01.transfinder.com/arcgis/rest/services/";

export function getStops():Promise<any[]>{
    const midPointLayer= new FeatureLayer({
        url:arcgisServerUrl+"Patrol/PatrolStreetsAndStops/MapServer/0"
    });
    const endPointLayer= new FeatureLayer({
        url:arcgisServerUrl+"Patrol/PatrolStreetsAndStops/MapServer/1"
    });
    let stops:any[] = [];
    const query = new Query();
    query.where ="1=1";
    query.returnGeometry = true;
    query.outFields = ["OBJECTID"];
    return Promise.all([midPointLayer.queryFeatures(query),endPointLayer.queryFeatures(query)]).then(results=>{
        results[0].features.forEach(feature=>{
            stops.push({
                geometry:feature.geometry,
                attributes:{
                    CurbApproach:3,//no u-turn
                    Name:"mid_"+feature.attributes["OBJECTID"]
                }
            });
        });
        results[1].features.forEach(feature=>{
            stops.push({
                geometry:feature.geometry,
                attributes:{
                    CurbApproach:0,//either side
                    Name:"end_"+feature.attributes["OBJECTID"]
                }
            });
        });
        return stops;
    });
}

export function solve(startPoint:Point, allStops:any[]): Promise<any> {
  if (!startPoint) {
    throw Error("Please provide a starting point to solve route!");
  }
  const featureSet = new FeatureSet({
      features:allStops
  });
  const routeParams = new RouteParameters({
      stops:featureSet,
      impedanceAttribute:"Length",
      restrictUTurns:"allow-backtrack",
      returnStops:true,
      findBestSequence:true,
      preserveFirstStop:true
  });
  const routeTask = new RouteTask({
      url:arcgisServerUrl+"Patrol/PatrolLocalRoute/NAServer/Route"
  });
  return routeTask.solve(routeParams).then(function(results:any){
    let paths = [...new Set([].concat(...results.routeResults[0].route.geometry.paths))]
    let mergedPathGeometry = new Polyline({
        spatialReference:results.routeResults[0].route.geometry.spatialReference,
        paths:paths,
    });
    return {
        route:{
            geometry:mergedPathGeometry
        },
        stops:results.routeResults[0].stops
    }
  });
}

export function getCrossTimes(stop:any, pathGeometry:Polyline):number{
    let buffer = geometryEngine.buffer(stop.geometry,0.2,"meters");
    let intersection = geometryEngine.intersect(buffer, pathGeometry) as Polyline; 
    let crossTimes = intersection?intersection.paths.length:1;
    return crossTimes;
}