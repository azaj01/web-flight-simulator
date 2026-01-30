import * as Cesium from 'cesium';

let viewer;
let miniViewer;

export function initCesium() {
	viewer = new Cesium.Viewer("cesiumContainer", {
		terrain: Cesium.Terrain.fromWorldTerrain(),
		timeline: false,
		animation: false,
		baseLayerPicker: false,
		geocoder: false,
		homeButton: false,
		infoBox: false,
		sceneModePicker: false,
		selectionIndicator: false,
		navigationHelpButton: false,
		fullscreenButton: false,
		shouldAnimate: false, 
	});

	// Initialize Minimap Viewer with Flat Satellite Imagery
	miniViewer = new Cesium.Viewer("minimapCesium", {
		terrain: null, // Keeps it flat (no 3D mountains)
		timeline: false,
		animation: false,
		baseLayerPicker: false,
		geocoder: false,
		homeButton: false,
		infoBox: false,
		sceneModePicker: false,
		selectionIndicator: false,
		navigationHelpButton: false,
		fullscreenButton: false,
		shouldAnimate: false,
		skyBox: false,
		skyAtmosphere: false,
		contextOptions: {
			webgl: {
				preserveDrawingBuffer: true
			}
		}
	});

	// Basic optimizations for both
	[viewer, miniViewer].forEach(v => {
		v.scene.requestRenderMode = true;
		v.scene.maximumRenderTimeChange = Infinity;
		v.scene.globe.maximumScreenSpaceError = 2; // High detail terrain
		v.resolutionScale = 0.75;

		// Disable default Cesium camera controls
		v.scene.screenSpaceCameraController.enableRotate = false;
		v.scene.screenSpaceCameraController.enableTranslate = false;
		v.scene.screenSpaceCameraController.enableZoom = false;
		v.scene.screenSpaceCameraController.enableTilt = false;
		v.scene.screenSpaceCameraController.enableLook = false;
		
		// Set min and max zoom distances
		v.scene.screenSpaceCameraController.minimumZoomDistance = 200;
		v.scene.screenSpaceCameraController.maximumZoomDistance = 25000000;
		
		// Persistence & Caching - High performance for flight
		v.scene.globe.tileCacheSize = 2048; // Significantly increase cache for 360-degree turns
		v.scene.globe.preloadAncestors = true;
		v.scene.globe.preloadSiblings = true;
		v.scene.globe.loadingDescendantLimit = 20; // Allow more concurrent loads
		
		// Skip LODs to reduce intermediate tile fetch and stutter
		v.scene.globe.skipLevelOfDetail = true;
		v.scene.globe.baseScreenSpaceError = 1024;
		v.scene.globe.skipScreenSpaceErrorFactor = 16;
		v.scene.globe.skipLevels = 1;
		
		v._cesiumWidget._creditContainer.style.display = "none";
	});

	// Performance optimizations specifically for minimap
	miniViewer.scene.globe.enableLighting = false;
	miniViewer.scene.globe.showGroundAtmosphere = false;
	miniViewer.scene.fog.enabled = false;
	miniViewer.scene.highDynamicRange = false; 
	miniViewer.scene.postProcessStages.fxaa.enabled = false; 
	miniViewer.resolutionScale = 1.0; // Keep minimap sharp
	miniViewer.scene.globe.maximumScreenSpaceError = 2; // Keep minimap terrain detailed
	miniViewer.scene.globe.baseColor = Cesium.Color.BLACK; 
	if (miniViewer.scene.skyAtmosphere) miniViewer.scene.skyAtmosphere.show = false;

	// Better Sky and Lighting for main viewer
	viewer.scene.globe.enableLighting = true;
	viewer.scene.highDynamicRange = false;
	viewer.scene.postProcessStages.fxaa.enabled = true;
	viewer.scene.skyAtmosphere = new Cesium.SkyAtmosphere();
	
	viewer.scene.fog.enabled = true;
	viewer.scene.fog.density = 0.0001;

	// Disable default controls initially (especially for flight)
	setControlsEnabled(false);

	return viewer;
}

export function setControlsEnabled(enabled) {
	if (!viewer) return;
	// Only enable controls for the main viewer
	const ctrl = viewer.scene.screenSpaceCameraController;
	ctrl.enableRotate = enabled;
	ctrl.enableTranslate = enabled;
	ctrl.enableZoom = enabled;
	ctrl.enableTilt = enabled;
	ctrl.enableLook = enabled;
}

export function setCameraToPlane(lon, lat, alt, heading, pitch, roll) {
	if (!viewer) return;

	viewer.camera.setView({
		destination: Cesium.Cartesian3.fromDegrees(lon, lat, alt),
		orientation: {
			heading: Cesium.Math.toRadians(heading),
			pitch: Cesium.Math.toRadians(pitch),
			roll: Cesium.Math.toRadians(roll)
		}
	});
	
	viewer.scene.requestRender();
}

export function setMinimapCamera(lon, lat, altitude, heading) {
	if (!miniViewer) return;

	// Safety check: prevent rendering if container has no size (crashes Cesium)
	if (miniViewer.canvas.width === 0 || miniViewer.canvas.height === 0) {
		return;
	}

	miniViewer.camera.setView({
		destination: Cesium.Cartesian3.fromDegrees(lon, lat, altitude),
		orientation: {
			heading: Cesium.Math.toRadians(heading),
			pitch: Cesium.Math.toRadians(-90), // Top-down
			roll: 0
		}
	});
	
	miniViewer.scene.requestRender();
}

export function getViewer() {
	return viewer;
}

export function getMiniViewer() {
	return miniViewer;
}
