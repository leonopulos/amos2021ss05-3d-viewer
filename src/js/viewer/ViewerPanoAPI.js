"use strict";

import { ViewerViewState } from "./ViewerViewState.js";
import { DEFAULT_FOV, MAX_FOV, MIN_FOV, ZOOM_SPEED, PAN_SPEED, ARROW_LEFT_RIGHT_SPEED, ARROW_UP_DOWN_DISTANCE, PLUS_MINUS_ZOOM_SPEED } from "./ViewerConfig.js";
import { EventPosition } from "./EventPosition.js";

export class ViewerPanoAPI {

    floorPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);

    constructor(viewerAPI) {
        this.viewerAPI = viewerAPI;
        this.addedLayers = new Set(); // EventMesh and EventLayer objects added via addLayer();

        this.scene = new THREE.Scene(); // three.js scene used by the panorama (3D) viewer
        this.camera = new THREE.PerspectiveCamera(DEFAULT_FOV, window.innerWidth / window.innerHeight, 1, 1100);
        this.camera.up = new THREE.Vector3(0, 0, 1);
        this.sphereRadius = 10;

        // number of lights - needed for external API EventMesh integration
        this.lights = 0;

        // property needed for display method 
        this.loadedMesh = null;

        // property needed for depthAtPointer method
        this.depthCanvas = document.createElement("canvas");
        // according to model data information depth pictures always have the same size
        this.depthCanvas.getContext("2d").canvas.width = 1024;
        this.depthCanvas.getContext("2d").canvas.height = 512;

        // handeling zooming / panning / moving / resizing
        const panoViewer = document.getElementById('pano-viewer');
        this.viewerViewState = new ViewerViewState(DEFAULT_FOV, 0, 0);
        this.lastViewState;
        this.lastMousePos;
        panoViewer.addEventListener('wheel', (event) => this.onDocumentMouseWheel(event));
        panoViewer.addEventListener('pointerdown', (event) => this.onPointerDown(event));
        panoViewer.addEventListener('dblclick', (event) => this.onDoubleClick(event));
        panoViewer.addEventListener('mousemove', (event) => this.onMouseMove(event));
        window.addEventListener("resize", () => this.onWindowResize());
        // Two new event listeneres are called to handle *how far* the user drags
        this.oPM = (event) => this.onPointerMove(event);
        this.oPU = () => this.onPointerUp();

        // event listener for arrow keys
        document.addEventListener('keydown', (event) => this.arrowKeyHandler(event));
        
        // handeling EventMesh / EventLayer API integration
        panoViewer.addEventListener('click', (event) => this.meshCheckClick(event));
        panoViewer.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            this.meshCheckRightClick(event);
        });
        this.hoveredMeshes = new Set(); // meshes that the mouse pointer is currently over
        panoViewer.addEventListener('pointermove', (event) => this.meshCheckMouseOver(event));
        this.draggedMeshes = new Set(); // meshes that the mouse is currently dragging (left button pressed)
        panoViewer.addEventListener('mousedown', (event) => this.meshCheckStartDragging(event));
        panoViewer.addEventListener('pointermove', (event) => this.meshCheckWhileDragging(event));
        panoViewer.addEventListener('mouseup', () => this.meshCheckEndDragging());

        this.display(this.viewerAPI.image.currentImageId);

        // handling duplication of showing closest mesh
        this.bestImg = this.viewerAPI.image.currentImage;
        this.lastBestImg = this.viewerAPI.image.currentImage;

    }

    // displays the panorama with idx *ImageNum* in the model (externally always called without a second parameter)
    display(imageNum, resolution = 0) {
        if (resolution > 3) return; // loaded highest res already
        if (resolution != 0 && imageNum != this.viewerAPI.image.currentImageId) return; // changed location in the meantime

        const resourceURL = this.viewerAPI.baseURL + Math.trunc(imageNum / 100) + '/' + imageNum + 'r' + resolution + '.jpg';
        if (resolution > 0) {
            // load the 360-panorama image data
            this.viewerAPI.textureLoader.load(
                resourceURL,
                (texturePano) => {
                    this.loadedMesh.material.map = texturePano
                    this.loadedMesh.material.mapping = THREE.EquirectangularReflectionMapping; // not sure if this line matters

                    this.loadedMesh.material.needsUpdate = true;

                    this.display(imageNum, resolution + 1);
                }
            );
            
            // only needed to update the resolution
            return;
        }

        // --- initial case from here on (resolution == 0) ---
        this.viewerAPI.image.currentImageId = imageNum;

        // load depth-map for panorama
        const image = document.createElementNS('http://www.w3.org/1999/xhtml', 'img');
        image.crossOrigin = 'use-credentials';
        image.src = this.viewerAPI.baseURL + Math.trunc(imageNum / 100) + '/' + imageNum + 'd.png';
        image.addEventListener('load', () => {
            this.depthCanvas.getContext("2d").drawImage(image, 0, 0);
        });
        image.addEventListener('error', function(event) {
            console.error(event);
        });
        
        // create sphere
        const sphere = new THREE.SphereGeometry(this.sphereRadius, 60, 40);
        // invert the geometry on the x-axis so that we look out from the middle of the sphere
        sphere.scale(-1, 1, 1);
        sphere.rotateX(Math.PI / 2);

        // load the 360-panorama image data
        this.viewerAPI.textureLoader.load(
            resourceURL,
            (texturePano) => {
                texturePano.mapping = THREE.EquirectangularReflectionMapping; // not sure if this line matters

                // put the texture on the spehere and add it to the scene
                const mesh = new THREE.Mesh(sphere, new THREE.MeshBasicMaterial({ map: texturePano }));

                // adjust for orientation offset
                mesh.applyQuaternion(this.viewerAPI.image.currentImage.orientation);

                // put in the correct position in the scene
                const localCoord = this.viewerAPI.toLocal(this.viewerAPI.image.currentImage.pos);
                mesh.position.set(localCoord.x, localCoord.y, localCoord.z);

                // check if other panorama was previously already loaded
                if (this.loadedMesh != null) {
                    this.scene.remove(this.loadedMesh);
                }

                this.scene.add(mesh);
                this.loadedMesh = mesh;

                // put camera inside sphere mesh
                this.camera.position.set(localCoord.x, localCoord.y, localCoord.z);

                this.display(imageNum, resolution + 1);
            }
        );
    }

    camera() {
        return this.camera;
    }

    // Set the panorama view characteristics.
    view(lonov, latov, fov) {
        const normalizedViewingDirection = lonLatToLocal(lonov, latov);

        // adjust looking direction for offset of current mesh in scene
        const localCoord = this.viewerAPI.toLocal(this.viewerAPI.image.currentImage.pos);

        this.camera.lookAt(localCoord.add(normalizedViewingDirection));

        this.camera.fov = THREE.MathUtils.clamp(fov, MIN_FOV, MAX_FOV);

        this.camera.updateProjectionMatrix();
    }

    // Add an event layer to the panorama (3D) viewer.
    // param: EventLayer (or EventMesh) to add
    addLayer(layer) {
        if (!layer) return;
        if (this.addedLayers.has(layer)) return;

        if (layer.material != null) {
            // eventMesh, not eventLayer passed (has visual representation)
            this.scene.add(layer);
        }
        this.addedLayers.add(layer);
    }

    removeLayer(layer) {
        if (!layer) return;
        if (!this.addedLayers.has(layer)) return;

        if (layer.material != null) {
            // eventMesh, not eventLayer passed (has visual representation)
            this.scene.remove(layer);
        }
        this.addedLayers.delete(layer);
    }

    // ----- Event handling functions for panning, zooming and moving -----
    onPointerDown(event) {
        this.lastMousePos = [event.clientX, event.clientY];

        this.lastViewState = [this.viewerViewState.lonov, this.viewerViewState.latov];

        document.addEventListener('pointermove', this.oPM);
        document.addEventListener('pointerup', this.oPU);
    }

    // handles continues update of the distance mouse moved
    onPointerMove(event) {
        const scalingFactor = this.camera.fov / MAX_FOV;
    
        this.viewerViewState.setLonov((event.clientX - this.lastMousePos[0]) * PAN_SPEED * scalingFactor + THREE.Math.radToDeg(this.lastViewState[0]));
        this.viewerViewState.setLatov((event.clientY - this.lastMousePos[1]) * PAN_SPEED * scalingFactor + THREE.Math.radToDeg(this.lastViewState[1]));

        this.viewerAPI.map.show_direction();
    }

    // this event listener is called when the user *ends* moving the picture
    onPointerUp() {
        document.removeEventListener('pointermove', this.oPM);
        document.removeEventListener('pointerup', this.oPU);

        this.viewerAPI.propagateEvent("viewed", this.viewerViewState, true);
    }

    onDocumentMouseWheel(event) {
        this.viewerViewState.fov = this.camera.fov + event.deltaY * ZOOM_SPEED;

        this.viewerAPI.propagateEvent("viewed", this.viewerViewState, true);
        this.viewerAPI.map.show_direction();
    }

    onDoubleClick(event) {
        this.display(this.bestImg.id);
        this.viewerAPI.map.redraw();

        this.viewerAPI.propagateEvent("moved", this.viewerAPI.image.currentImage.id, true);
    }

    onMouseMove(event) {
        const raycaster = this.getRaycaster(event);

        // check if looking down
        if (localToLonLat(raycaster.ray.direction)[1] > 0) return;

        // line between camera-cursor (1000m long)
        const lineEnd = raycaster.ray.origin.clone().addScaledVector(raycaster.ray.direction, 1000);
        const line = new THREE.Line3(raycaster.ray.origin, lineEnd);
        
        // intersection between viewing direction and floor plane
        const intersection = this.floorPlane.intersectLine(line);

        // will be null if no intersection found
        if (!intersection) return;

        // math from https://en.wikipedia.org/wiki/Line%E2%80%93plane_intersection algebraic form (code currently broken)
        // const planeNormal = new THREE.Vector3(0, 0, 1);             // n
        // const planeOrigin = new THREE.Vector3(0, 0, 0);             // p0
        // const lineDirection = raycaster.ray.direction.clone();      // l
        // const lineOrigin = raycaster.ray.origin.clone();            // l0

        // const distance = (planeOrigin.clone().sub(lineOrigin)).multiply(planeNormal)
        //     .divide(lineDirection.clone().multiply(planeNormal));

        // const intersection = lineOrigin.clone().add(lineOrigin.clone().multiplyScalar(distance));
        
        // console.log(distance, intersection);
        // -- would be better to use some direct math (like attempted here) instead of heavy intersectLine function


        // creating a circle mesh
        const geometry = new THREE.CircleBufferGeometry(0.4, 32);
        const xMarkTexture = new THREE.TextureLoader().load('x-mark.png');
        const material = new THREE.MeshBasicMaterial({ opacity: 0.5, transparent: true, map: xMarkTexture });
        const circleMesh = new THREE.Mesh(geometry, material);

        if (false) {
            // for debugging - x-mark is displayed as cursor on floor
            circleMesh.position.set(intersection.x, intersection.y, intersection.z);
            
            if (this.lastMesh) {
                this.removeLayer(this.lastMesh);
            }
            this.addLayer(circleMesh);
            this.lastMesh = circleMesh;
            
            return;
        } 
        
        let minDistance = this.sphereRadius + 5;

        this.viewerAPI.image.calcImagesInPanoSphere(this.sphereRadius, this.viewerAPI).forEach(element => {
            const currLocalPos = this.viewerAPI.toLocal(element.pos);
            // Get the distance with no height
            const [dx, dy] = [intersection.x - currLocalPos.x, intersection.y - currLocalPos.y];
            const currDistance = Math.sqrt(dx * dx + dy * dy);
            if (currDistance < minDistance) {
                minDistance = currDistance;
                this.bestImg = element;
            }
        });
        
        // avoid duplication
        if (this.bestImg == this.lastBestImg) return;
        
        const closestPos = this.viewerAPI.toLocal(this.bestImg.pos);
        circleMesh.position.set(closestPos.x, closestPos.y, 0); // in local coords ground is always at 0, regardless of floor 
        
        // save some parameters to avoid duplication
        this.lastBestImg = this.bestImg;
        if (this.lastMesh) {
            this.removeLayer(this.lastMesh);
        }
        this.addLayer(circleMesh);
        this.lastMesh = circleMesh;
    };

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();

        this.viewerAPI.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    arrowKeyHandler(event) {
        const currentPos = this.viewerAPI.toLocal(this.viewerAPI.image.currentImage.pos);
        const viewingDirection = lonLatToLocal(this.viewerViewState.lonov, this.viewerViewState.latov);
        
        switch (event.key) {
            case "ArrowLeft":
                this.viewerViewState.setLonov(THREE.Math.radToDeg(this.viewerViewState.lonov) + ARROW_LEFT_RIGHT_SPEED);

                this.viewerAPI.propagateEvent("viewed", this.viewerViewState, true);
                break;
            case "ArrowRight":
                this.viewerViewState.setLonov(THREE.Math.radToDeg(this.viewerViewState.lonov) - ARROW_LEFT_RIGHT_SPEED);

                this.viewerAPI.propagateEvent("viewed", this.viewerViewState, true);
                break;
            case "ArrowUp":
                const forward = currentPos.addScaledVector(viewingDirection, ARROW_UP_DOWN_DISTANCE);
                const globalForward = this.viewerAPI.toGlobal(forward);
                this.viewerAPI.move(globalForward[0], globalForward[1], globalForward[2]);

                this.viewerAPI.propagateEvent("moved", this.viewerAPI.image.currentImage.id, true);
                break;
            case "ArrowDown":
                // negative distance because walking backwards
                const backward = currentPos.addScaledVector(viewingDirection, - ARROW_UP_DOWN_DISTANCE);
                const globalBackward = this.viewerAPI.toGlobal(backward);
                this.viewerAPI.move(globalBackward[0], globalBackward[1], globalBackward[2]);

                this.viewerAPI.propagateEvent("moved", this.viewerAPI.image.currentImage.id, true);
                break;
            case "+":
                this.viewerViewState.fov = this.camera.fov - PLUS_MINUS_ZOOM_SPEED;

                this.viewerAPI.propagateEvent("viewed", this.viewerViewState, true);
                break;
            case "-":
                this.viewerViewState.fov = this.camera.fov + PLUS_MINUS_ZOOM_SPEED;

                this.viewerAPI.propagateEvent("viewed", this.viewerViewState, true);
                break;
        }
        this.viewerAPI.map.show_direction();
    }

    // ---- event handeling functions for EventMesh / EventLayer API interaction ----
    getIntersectingMeshes(event) {
        const raycaster = this.getRaycaster(event);

        // calculate objects intersecting the picking ray
        const intersects = raycaster.intersectObjects(this.scene.children);

        // include only meshes that are in sphere radius 
        const meshes = [];
        for (const e in intersects) {
            // check if mesh is within sphere radius to camera
            const dist = this.camera.position.distanceTo(intersects[e].object.position);
            if (dist < this.sphereRadius) {
                meshes.push(intersects[e].object);
            }
        }

        return meshes;
    }

    meshCheckClick(event) {
        const meshes = this.getIntersectingMeshes(event);
        const xy = new EventPosition(event);
        const location = this.getCursorLocation(event);

        meshes.forEach((mesh) => {
            if (typeof mesh.vwr_onclick == "function") {
                mesh.vwr_onclick(xy, location);
            }
        });
    }

    meshCheckRightClick(event) {
        const meshes = this.getIntersectingMeshes(event);
        const xy = new EventPosition(event);
        const location = this.getCursorLocation(event);

        const callbackList = [];
        meshes.forEach((mesh) => {
            if (typeof mesh.vwr_oncontext == "function") {
                const callback = mesh.vwr_oncontext(xy, location);

                callback.forEach((elem) => callbackList.push(elem));
            }
        });

        // call onContext for all eventLayers that were added (no visual representation)
        this.addedLayers.forEach(layer => {
            if (layer.material != null) return;

            if (typeof layer.vwr_oncontext == "function") {
                const callback = layer.vwr_oncontext(xy, location);

                callback.forEach((elem) => callbackList.push(elem));
            }
        });

        if (callbackList.length == 0) return;

        $.contextMenu('destroy');
        $.contextMenu({
            selector: '#pano-viewer',
            items: callbackList,
        });
    }

    meshCheckMouseOver(event) {
        const meshes = this.getIntersectingMeshes(event);

        // check for meshes that mouse pointer is no longer over
        this.hoveredMeshes.forEach((preMesh) => {
            if (!meshes.includes(preMesh)) {
                if (typeof preMesh.vwr_onpointerleave == "function") {
                    this.hoveredMeshes.delete(preMesh);
                    
                    preMesh.vwr_onpointerleave();
                }
            }
        });

        // check for meshes that mouse pointer is newly over
        meshes.forEach((mesh) => {
            if (!this.hoveredMeshes.has(mesh)) {
                if (typeof mesh.vwr_onpointerenter == "function") {
                    this.hoveredMeshes.add(mesh);
                    
                    mesh.vwr_onpointerenter();
                }
            }
        });
    }

    meshCheckStartDragging(event) {
        const meshes = this.getIntersectingMeshes(event);
        const xy = new EventPosition(event);
        const location = this.getCursorLocation(event);

        meshes.forEach((mesh) => {
            if (!this.draggedMeshes.has(mesh)) {
                if (typeof mesh.vwr_ondragstart == "function") {
                    this.draggedMeshes.add(mesh);
                    
                    mesh.vwr_ondragstart(xy, location);
                }
            }
        });
    }

    meshCheckWhileDragging(event) {
        const xy = new EventPosition(event);
        const location = this.getCursorLocation(event);

        this.draggedMeshes.forEach((mesh) => {
            if (typeof mesh.vwr_ondrag == "function") {
                mesh.vwr_ondrag(xy, location);
            }
        });
    }

    meshCheckEndDragging() {
        this.draggedMeshes.forEach((mesh) => {
            if (typeof mesh.vwr_ondragend == "function") {
                
                mesh.vwr_ondragend();
            }
        });

        this.draggedMeshes.clear();
    }

    // returns: the depth information (in meter) of the panorama at the current curser position (event.clientX, event.clientY)
    depthAtPointer(event) {
        const raycaster = this.getRaycaster(event);
        // because depth map is not rotated by quaternion like panorama mesh, the quaternion adjustment need to happen first
        const mappedCursorDirection = raycaster.ray.direction.applyQuaternion(this.viewerAPI.image.currentImage.orientation);
        const [cursorLon, cursorLat] = localToLonLat(mappedCursorDirection);

        // adjust to calculate pixel offset on image, values in [0;360, -90;90]
        const [adjustedLonov, adjustedLatov] = [((180 - cursorLon) + 360) % 360, cursorLat];
        
        // pixel offsets in depth map at current curser position
        const pixelX = Math.trunc((adjustedLonov / 360) * this.depthCanvas.width);
        const pixelY = Math.trunc((adjustedLatov + 90) / 180 * this.depthCanvas.height);

        // convert pixel value to depth information
        const imgData = this.depthCanvas.getContext("2d").getImageData(pixelX, pixelY, 1, 1);
        const [red, green, blue, alpha] = imgData.data;

        // LSB red -> green -> blue MSB (ignore alpha)
        const distanceMM = red | (green << 8) | (blue << 16);

        // convert from millimeter to meter
        return distanceMM / 1000;
    }

    // returns the current location of the cursor in the three js scene (Vector3)
    getCursorLocation(event) {
        const raycaster = this.getRaycaster(event);
        // formula for position is currentLoc + direction*distance (where the direction is normalized)
        const distance = this.depthAtPointer(event);
        const cursorLocation = raycaster.ray.origin.addScaledVector(raycaster.ray.direction, distance);
        return cursorLocation;
    }

    getRaycaster(event) {
        // calculate mouse position in normalized device coordinates
        // (-1 to +1) for both components
        const mouse = new THREE.Vector2();
        const raycaster = new THREE.Raycaster();

        mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        mouse.y = - (event.clientY / window.innerHeight) * 2 + 1;
        
        raycaster.setFromCamera(mouse, this.camera);
    
        return raycaster;
    }

}

// returns a normalized Vector3 pointing in the direction specified by lonov latov
const lonLatToLocal = (lonov, latov) => {
    const latDeg = THREE.Math.radToDeg(latov);
    const lonDeg = THREE.Math.radToDeg(lonov);

    const phi = THREE.MathUtils.degToRad(90 - latDeg);
    const theta = THREE.MathUtils.degToRad(lonDeg);

    const x = Math.sin(phi) * Math.cos(theta);
    const y = Math.sin(phi) * Math.sin(theta);
    const z = Math.cos(phi);

    return new THREE.Vector3(-x, -y, z);
}

// inverse operation to above
const localToLonLat = (vec) => {
    const phi = Math.acos(vec.z);
    const theta = Math.atan2(-vec.y, -vec.x);

    const latov = THREE.MathUtils.radToDeg(phi);
    const lonov = (THREE.MathUtils.radToDeg(theta) + 360) % 360;

    return [lonov, 90 - latov];
}