import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import Query from "@arcgis/core/tasks/support/Query";
import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import RouteParameters from "@arcgis/core/tasks/support/RouteParameters";
import FeatureSet from "@arcgis/core/tasks/support/FeatureSet";
import RouteTask from "@arcgis/core/tasks/RouteTask";
import * as geometryEngine from "@arcgis/core/geometry/geometryEngine";
import Geoprocessor from "@arcgis/core/tasks/Geoprocessor";
import Graphic from "@arcgis/core/Graphic";

export const arcgisServerUrl:string = "http://192.168.8.9/arcgis/rest/services/";

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

export function solve(startPoint:Point, allStops:any[], uturnPolicy:any): Promise<any> {
  if (!startPoint) {
    throw Error("Please provide a starting point to solve route!");
  }
  const featureSet = new FeatureSet({
      features:allStops
  });
  const routeParams = new RouteParameters({
      stops:featureSet,
      impedanceAttribute:"Length",
      restrictUTurns: uturnPolicy,
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

export function getCrossTimes(midPoint:any, pathGeometries:Polyline[]):number{
    let crossTimes = 0;
    pathGeometries.forEach(path=>{
        let buffer = geometryEngine.buffer(midPoint,0.2,"meters");
        let intersection = geometryEngine.intersect(buffer, path) as Polyline; 
        crossTimes += intersection?intersection.paths.length:0;
    });
    return crossTimes;
}

export function vrp(startPoints:any[], allStops:any[], uturnPolicy:any):Promise<any>{
    if (!startPoints || startPoints.length==0) {
        throw Error("Please provide a starting point to vrp!");
    }
    let processor = new Geoprocessor({
        url:arcgisServerUrl+"Patrol/SolveVehicleRoutingProblem/GPServer/Solve%20Vehicle%20Routing%20Problem"
    });
    let orders = new FeatureSet(),
        depots = new FeatureSet(),
        routes = new FeatureSet();

    //add vehicle starting locations as depots
    //add routes(place holder for result patrol routes)
    for (let index = 0; index < startPoints.length; index++) {
        depots.features.push(new Graphic({
            geometry:startPoints[index].geometry,
            attributes:{
                Name: "startPoint_"+index,
                CurbApproach:0//Either side
            }
        }));
        routes.features.push(new Graphic({
            geometry:new Polyline({
                spatialReference:startPoints[index].geometry.spatialReference,
                paths:[]
            }),
            attributes:{
                Name:index,
                StartDepotName:"startPoint_"+index,
                MaxOrderCount:1000
            }
        }))
    }

    //add street midpoint and endpoints as orders
    for (let index = 0; index < allStops.length; index++) {
        orders.features.push(new Graphic({
            geometry:allStops[index].geometry,
            attributes:{
                Name:allStops[index].attributes.Name,
                CurbApproach:3,//no-uturn,
                AssignmentRule:3,//override
            }
        }));
    }

    let params = {
        "orders":orders,
        "depots":depots,
        "routes":routes,
        "spatially_cluster_routes":true,
        "time_attributes":"Time",
        "f": "pjson",
        "default_date": 1355212800000,
        "route_line_simplification_tolerance": {
            "distance": 1,
            "units": "esriMeters"
        },
        'uturn_policy':uturnPolicy
    }

    return processor.submitJob(params).then(jobInfo=>{
        let jobid = jobInfo.jobId;
        return processor.waitForJobCompletion(jobid, {}).then(res=>{
            return gpJobComplete(res);
        })
    });

    function gpJobComplete(gpResponse:any):Promise<any>{
        if (gpResponse.jobStatus.indexOf("failed") >= 0)
        {
            return Promise.resolve(false);
        }
        let jobId = gpResponse.jobId;
        let resultNames = ["solve_succeeded","out_routes","out_stops"];

        let promises:any[] = [];
        resultNames.forEach(resultName=>{
            promises.push(processor.getResultData(jobId,resultName));
        });

        return Promise.all(promises).then(results=>{
            if(results[0].value){
                let outRoutes = results[1].value.features;
                outRoutes.forEach((route:any) => {
                    let paths = [...new Set([].concat(...route.geometry.paths))]
                    let mergedPathGeometry = new Polyline({
                        spatialReference:route.geometry.spatialReference,
                        paths:paths,
                    });
                    route.geometry = mergedPathGeometry;
                });
                let outStops = results[2].value.features;
                outStops.forEach((os: any) => {
                    let inputOrder = orders.features.find(is=>is.attributes.Name == os.attributes.Name);
                    if(inputOrder){
                        os.geometry = inputOrder.geometry
                    }
                });
                let vrpResult = {
                    stops:outStops,
                    routes:outRoutes,
                }
                return Promise.resolve(vrpResult);
            }else{
                throw Error("VRP failed!");
            }
        })
    }
}



