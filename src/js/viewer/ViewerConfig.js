"use strict";

// Configurable values to change some aspects of the ViewerPanoAPI

// Describes the Field of View of the camera displaying the panorama. 
// A lower value means a more narrow FOV
export const DEFAULT_FOV = 80;
export const MAX_FOV = 100;
export const MIN_FOV = 10;

// Describes how much mouse wheel scrolling is needed to zoom in the picture. 
// A higher value means zooming is faster (also more stuttered)
export const ZOOM_SPEED = 0.05;

// Describes how much the mouse has to be moved for the picture to pan
// A higher value means panning is quicker
export const PAN_SPEED = 0.1;

// Amount of degrees changed on one arrow key press left-right
export const ARROW_LEFT_RIGHT_SPEED = 3;

// Distance walked forward-backward (meter) on arrow key press
export const ARROW_UP_DOWN_DISTANCE = 2.5;

// Change in FOV (degrees) on +/- keyboard buttons;
export const PLUS_MINUS_ZOOM_SPEED = 5;


//Configurable values to change some aspects of the ViewerMapAPI

// Describes the Field of View of scaling of displayed on the map. 
export const SCALING_MAP = 0.1;

// Scalar for Longitude from degree to km
export const LON_SCALAR = 71.5;

// Scalar for Langitude from degree to km
export const LAN_SCALAR = 111.3;
