"use strict";

export class POIConverter {

    constructor(POImetadata, api) {
        this.viewerAPI = api;
        this.pois = {};

        let lines = POImetadata.split("("); // first line is empty
        for (let i = 1; i < lines.length; i++) {
            let currID = parseInt(lines[i].split(",")[0]) // ID of the current POI

            let coords = lines[i].split(/[[\]]/)[1].split(",").map((x) => parseFloat(x));

            this.pois[currID] = coords;
        }
    }

    insertObjectsInScene() {
        for (let key in this.pois) {
            const sphere = new this.viewerAPI.THREE.SphereGeometry(1 / 10, 10, 10); // TODO make smaller
            const poiMesh = new this.viewerAPI.THREE.Mesh(sphere, new this.viewerAPI.THREE.MeshBasicMaterial());
            const coords = this.viewerAPI.toLocal(this.pois[key]);
            poiMesh.position.set(coords.x, coords.y, coords.z);


            poiMesh.vwr_onpointerenter = () => {
                console.log("vwr_onpointerenter is triggered for POI " + key);

                this.viewerAPI.jQuery("#poi-desc").load("../pois/descriptions/descr" + key + ".txt", () => {
                    this.viewerAPI.jQuery("#poi-desc").css("display", "block");
                });
            }
            
            poiMesh.vwr_onpointerleave = () => {
                this.viewerAPI.jQuery("#poi-desc").css("display", "none");
            }
            
            this.viewerAPI.pano.addLayer(poiMesh);
        }
    }

}